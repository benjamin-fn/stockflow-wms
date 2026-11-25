using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using static StockService;

public record TransferInput(int ProductId, int From, int To, int Quantity, Guid OperationId);
public record UserInput(string Username, string Password, string Role);
public record UserUpdate(string Role, bool Active);

public static class CatalogApi
{
    public static readonly string[] Roles = ["Administrator", "Supervisor", "Worker"];
    public static void Map(RouteGroupBuilder api)
    {
        api.MapGet("/lookups", async (WarehouseDb db) => new {
            categories = await db.Categories.OrderBy(x => x.Name).ToListAsync(),
            suppliers = await db.Suppliers.OrderBy(x => x.Name).ToListAsync(),
            zones = await db.Zones.OrderBy(x => x.Name).ToListAsync(),
            locations = await db.Locations.OrderBy(x => x.Code).ToListAsync(),
            products = await db.Products.OrderBy(x => x.Name).ToListAsync()
        });
        api.MapGet("/products", async (WarehouseDb db, string? search, int? category, string? sort, bool? descending, int page = 1) =>
        {
            var query = db.Products.AsNoTracking();
            if (!string.IsNullOrWhiteSpace(search))
            {
                var term = search.Trim().ToUpperInvariant();
                query = query.Where(p => p.Name.ToUpper().Replace("å","Å").Replace("ä","Ä").Replace("ö","Ö").Contains(term) || p.Sku.ToUpper().Contains(term) || p.Barcode.Contains(term));
            }
            if (category.HasValue) query = query.Where(p => p.CategoryId == category);
            query = (sort, descending) switch {
                ("sku", true) => query.OrderByDescending(p => p.Sku), ("sku", _) => query.OrderBy(p => p.Sku),
                ("cost", true) => query.OrderByDescending(p => (double)p.Cost), ("cost", _) => query.OrderBy(p => (double)p.Cost),
                (_, true) => query.OrderByDescending(p => p.Name), _ => query.OrderBy(p => p.Name)
            };
            var total = await query.CountAsync();
            var products = await query.ThenById().Skip(Math.Clamp(page-1, 0, 100000)*12).Take(12).ToListAsync();
            var ids = products.Select(p => p.Id).ToArray();
            var balances = await db.Balances.Where(b => ids.Contains(b.ProductId)).ToListAsync();
            return new { total, items = products.Select(p => ProductView(p, balances)) };
        });
        api.MapGet("/products/{id:int}", async (int id, WarehouseDb db) =>
            await db.Products.FindAsync(id) is { } product
                ? Results.Ok(ProductView(product, await db.Balances.Where(b => b.ProductId == id).ToListAsync()))
                : Results.NotFound());
        api.MapPost("/products", (Product input, WarehouseDb db, StockService stock) => SaveProduct(0, input, db, stock)).RequireAuthorization("Supervisor");
        api.MapPut("/products/{id:int}", SaveProduct).RequireAuthorization("Supervisor");
        api.MapDelete("/products/{id:int}", async (int id, WarehouseDb db, StockService stock) => await stock.Atomic(async () =>
        {
            var product = await db.Products.FindAsync(id) ?? throw new RuleException("Artikeln finns inte.");
            Require(!await db.Balances.AnyAsync(b => b.ProductId == id && b.Reserved > 0), "Artikeln har reservationer.");
            product.Active = false;
            return product;
        })).RequireAuthorization("Supervisor");
        api.MapGet("/locations", async (WarehouseDb db) => new { locations = await db.Locations.OrderBy(l => l.Code).ToListAsync(), balances = await db.Balances.Where(b => b.Quantity > 0).ToListAsync() });
        api.MapPost("/locations", (Location input, WarehouseDb db, StockService stock) => SaveLocation(0,input,db,stock)).RequireAuthorization("Supervisor");
        api.MapPut("/locations/{id:int}", SaveLocation).RequireAuthorization("Supervisor");
        api.MapPost("/zones", async (Zone input, WarehouseDb db, StockService stock) => await stock.Atomic(async () =>
        {
            Require(Valid(input.Name) && !await db.Zones.AnyAsync(z => z.Name == input.Name.Trim()), "Ange ett unikt zonnamn.");
            var zone = new Zone { Name = input.Name.Trim() };
            db.Zones.Add(zone);
            return zone;
        })).RequireAuthorization("Supervisor");
        api.MapPost("/transfers", (TransferInput input, StockService stock, HttpContext c) => stock.Transfer(input.ProductId,input.From,input.To,input.Quantity,input.OperationId,UserIdentity.Name(c)));
        api.MapGet("/suppliers", async (WarehouseDb db) => new { items = await db.Suppliers.OrderBy(s => s.Name).ToListAsync(), deliveries = await db.Deliveries.OrderByDescending(d => d.Created).ToListAsync() });
        api.MapPost("/suppliers", (Supplier input, WarehouseDb db, StockService stock) => SaveSupplier(0,input,db,stock)).RequireAuthorization("Supervisor");
        api.MapPut("/suppliers/{id:int}", SaveSupplier).RequireAuthorization("Supervisor");
        api.MapDelete("/suppliers/{id:int}", async (int id, WarehouseDb db, StockService stock) => await stock.Atomic(async () =>
        {
            var supplier = await db.Suppliers.FindAsync(id) ?? throw new RuleException("Leverantören finns inte.");
            supplier.Active = false;
            return supplier;
        })).RequireAuthorization("Supervisor");
        api.MapGet("/assignees", async (WarehouseDb db) => (await db.Users.Select(u => new { u.Id, u.UserName, u.LockoutEnd }).ToListAsync()).Where(u => u.LockoutEnd is null || u.LockoutEnd <= DateTimeOffset.UtcNow).Select(u => new {u.Id,u.UserName})).RequireAuthorization("Supervisor");
        api.MapGet("/users", async (UserManager<IdentityUser> manager) =>
        {
            var rows = new List<object>();
            foreach (var user in await manager.Users.OrderBy(u => u.UserName).ToListAsync())
                rows.Add(new {user.Id,user.UserName,role=(await manager.GetRolesAsync(user)).FirstOrDefault(),active=!await manager.IsLockedOutAsync(user)});
            return rows;
        }).RequireAuthorization("Administrator");
        api.MapPost("/users", async (UserInput input, UserManager<IdentityUser> manager, StockService stock) => await stock.Atomic(async () =>
        {
            Require(Roles.Contains(input.Role) && Valid(input.Username), "Ange användarnamn och en giltig roll.");
            Require(input.Password is { Length: >= 8 and <= 128 }, "Ange ett lösenord med minst åtta tecken.");
            var user = new IdentityUser(input.Username.Trim()) { LockoutEnabled = true };
            Require((await manager.CreateAsync(user,input.Password)).Succeeded, "Användarnamnet är upptaget eller lösenordet saknar stor bokstav, liten bokstav, siffra eller specialtecken.");
            Require((await manager.AddToRoleAsync(user,input.Role)).Succeeded, "Rollen kunde inte sparas.");
            return new { user.Id, user.UserName };
        })).RequireAuthorization("Administrator");
        api.MapPut("/users/{id}", async (string id, UserUpdate input, UserManager<IdentityUser> manager, StockService stock, HttpContext c) => await stock.Atomic(async () =>
        {
            Require(id != UserIdentity.Id(c) && Roles.Contains(input.Role), "Du kan inte ändra din egen roll eller status.");
            var user = await manager.FindByIdAsync(id) ?? throw new RuleException("Användaren finns inte.");
            var roles = await manager.GetRolesAsync(user);
            if (!roles.Contains(input.Role))
            {
                Require((await manager.RemoveFromRolesAsync(user,roles)).Succeeded, "Rollen kunde inte ändras.");
                Require((await manager.AddToRoleAsync(user,input.Role)).Succeeded, "Rollen kunde inte ändras.");
            }
            Require((await manager.SetLockoutEndDateAsync(user,input.Active ? null : DateTimeOffset.UtcNow.AddYears(50))).Succeeded, "Kontots status kunde inte sparas.");
            Require((await manager.UpdateSecurityStampAsync(user)).Succeeded, "Sessionen kunde inte uppdateras.");
            return true;
        })).RequireAuthorization("Administrator");
        api.MapGet("/settings", async (WarehouseDb db) => await db.Settings.FindAsync(1) ?? new WarehouseSettings());
        api.MapPut("/settings", async (WarehouseSettings input, WarehouseDb db, StockService stock) => await stock.Atomic(async () =>
        {
            Require(Valid(input.Name), "Ange lagrets namn.");
            var settings = await db.Settings.FindAsync(1);
            if (settings is null) db.Settings.Add(settings = new WarehouseSettings());
            settings.Name=input.Name.Trim();
            return settings;
        })).RequireAuthorization("Administrator");
    }

    public static bool Valid(string? value) => !string.IsNullOrWhiteSpace(value) && value.Length <= 120;
    static IOrderedQueryable<Product> ThenById(this IQueryable<Product> query) => ((IOrderedQueryable<Product>)query).ThenBy(p => p.Id);
    static object ProductView(Product product, List<Balance> balances)
    {
        var stock = balances.Where(b => b.ProductId == product.Id).ToList();
        return new { product, quantity = stock.Sum(b => b.Quantity), reserved = stock.Sum(b => b.Reserved), available = stock.Sum(b => b.Quantity - b.Reserved), balances = stock };
    }

    static Task<Product> SaveProduct(int id, Product input, WarehouseDb db, StockService stock) => stock.Atomic(async () =>
    {
        Require(Valid(input.Name) && Valid(input.Sku) && Valid(input.Unit) && input.Minimum >= 0 && input.Cost is >= 0 and <= 100000000, "Kontrollera artikelnummer, namn, enhet, pris och minsta saldo.");
        Require(await db.Categories.AnyAsync(c => c.Id == input.CategoryId) && await db.Suppliers.AnyAsync(s => s.Id == input.SupplierId), "Välj kategori och leverantör.");
        var sku=input.Sku.Trim().ToUpperInvariant();
        var product = id == 0 ? new Product() : await db.Products.FindAsync(id) ?? throw new RuleException("Artikeln finns inte.");
        var barcode=string.IsNullOrWhiteSpace(input.Barcode) ? $"SF{Guid.NewGuid().ToString("N")[..12].ToUpperInvariant()}" : input.Barcode.Trim().ToUpperInvariant();
        Require(barcode.Length <= 40 && barcode.All(c => c >= 32 && c <= 126), "Streckkoden får innehålla högst 40 skrivbara ASCII-tecken.");
        Require(!await db.Products.AnyAsync(p => p.Id != id && (p.Sku == sku || p.Barcode == barcode)), "Artikelnumret eller streckkoden används redan.");
        Require(input.Active || !await db.Balances.AnyAsync(b => b.ProductId == id && b.Reserved > 0), "Artikeln har reservationer.");
        product.Name=input.Name.Trim(); product.Sku=sku; product.Barcode=barcode; product.Unit=input.Unit.Trim();
        product.Description=input.Description?.Trim() ?? ""; product.CategoryId=input.CategoryId; product.SupplierId=input.SupplierId;
        product.Cost=input.Cost; product.Minimum=input.Minimum; product.Active=input.Active;
        if (id == 0) db.Products.Add(product);
        return product;
    });

    static Task<Location> SaveLocation(int id, Location input, WarehouseDb db, StockService stock) => stock.Atomic(async () =>
    {
        Require(Valid(input.Code) && Valid(input.Aisle) && Valid(input.Shelf) && input.Capacity > 0 && await db.Zones.AnyAsync(z => z.Id == input.ZoneId), "Kontrollera platskod, gång, hylla, kapacitet och zon.");
        var code=input.Code.Trim().ToUpperInvariant();
        Require(!await db.Locations.AnyAsync(l => l.Id != id && l.Code == code), "Lagerplatskoden används redan.");
        var occupied=await db.Balances.Where(b => b.LocationId==id).SumAsync(b => (long)b.Quantity);
        Require(occupied <= input.Capacity && (input.Active || occupied == 0), "Lagerplatsen innehåller varor.");
        var location=id == 0 ? new Location() : await db.Locations.FindAsync(id) ?? throw new RuleException("Lagerplatsen finns inte.");
        location.Code=code; location.ZoneId=input.ZoneId; location.Aisle=input.Aisle.Trim(); location.Shelf=input.Shelf.Trim(); location.Capacity=input.Capacity; location.Active=input.Active;
        if (id == 0) db.Locations.Add(location);
        return location;
    });

    static Task<Supplier> SaveSupplier(int id, Supplier input, WarehouseDb db, StockService stock) => stock.Atomic(async () =>
    {
        Require(Valid(input.Name) && (string.IsNullOrWhiteSpace(input.Email) || new System.ComponentModel.DataAnnotations.EmailAddressAttribute().IsValid(input.Email)), "Ange företagsnamn och en giltig e-postadress.");
        var supplier=id==0 ? new Supplier() : await db.Suppliers.FindAsync(id) ?? throw new RuleException("Leverantören finns inte.");
        supplier.Name=input.Name.Trim(); supplier.Email=input.Email ?? ""; supplier.Contact=input.Contact ?? ""; supplier.Phone=input.Phone ?? "";
        supplier.Address=input.Address ?? ""; supplier.OrganizationNumber=input.OrganizationNumber ?? ""; supplier.Active=input.Active;
        if (id==0) db.Suppliers.Add(supplier);
        return supplier;
    });
}
