using Microsoft.EntityFrameworkCore;
using static StockService;

public record DeliveryInput(string Reference, int SupplierId, List<LineInput> Lines);
public record OrderInput(string Reference, string Customer, List<LineInput> Lines);
public record CountInput(int? ProductId, int? LocationId);

public static class WorkflowApi
{
    public static void Map(RouteGroupBuilder api)
    {
        api.MapGet("/deliveries", async (WarehouseDb db) => await db.Deliveries.Include(d => d.Lines).OrderBy(d => d.Status == "Completed" || d.Status == "Cancelled").ThenByDescending(d => d.Id).ToListAsync());
        api.MapPost("/deliveries", async (DeliveryInput input, WarehouseDb db, StockService stock) => await stock.Atomic(async () =>
        {
            Require(CatalogApi.Valid(input.Reference) && input.Lines is { Count: > 0 and <= 100 }, "Ange referens och minst en artikelrad.");
            Require(!await db.Deliveries.AnyAsync(d => d.Reference == input.Reference.Trim()), "Referensen används redan.");
            Require(await db.Suppliers.AnyAsync(s => s.Id == input.SupplierId && s.Active), "Välj en aktiv leverantör.");
            var delivery = new Delivery { Reference = input.Reference.Trim(), SupplierId = input.SupplierId };
            foreach (var line in input.Lines)
            {
                await ValidateLine(line, db);
                Require(await db.Locations.AnyAsync(l => l.Id == line.LocationId && l.Active), "Välj en aktiv lagerplats.");
                delivery.Lines.Add(new DeliveryLine { ProductId=line.ProductId, LocationId=line.LocationId, Expected=line.Quantity });
            }
            db.Deliveries.Add(delivery);
            return delivery;
        }));
        api.MapPost("/deliveries/{id:int}/{action}", (int id, string action, ActionInput input, StockService stock, HttpContext c) =>
            stock.Receive(id,action,input,UserIdentity.Name(c)));
        api.MapGet("/orders", async (WarehouseDb db) =>
            await db.Orders.Include(o => o.Lines).Include(o => o.Picking).ThenInclude(p => p!.Reservations).OrderBy(o => o.Status == "Shipped" || o.Status == "Cancelled").ThenByDescending(o => o.Id).ToListAsync()).RequireAuthorization("Supervisor");
        api.MapGet("/picking", async (WarehouseDb db, HttpContext c) =>
        {
            var query = db.Orders.Where(o => o.Picking != null);
            if (!UserIdentity.Supervisor(c)) query = query.Where(o => o.Picking!.AssigneeId == UserIdentity.Id(c));
            return await query.Include(o => o.Picking).ThenInclude(p => p!.Reservations).OrderBy(o => o.Status == "Shipped" || o.Status == "Cancelled").ThenByDescending(o => o.Id).ToListAsync();
        });
        api.MapPost("/orders", async (OrderInput input, WarehouseDb db, StockService stock) => await stock.Atomic(async () =>
        {
            Require(CatalogApi.Valid(input.Reference) && CatalogApi.Valid(input.Customer) && input.Lines is { Count: > 0 and <= 100 }, "Ange referens, mottagare och artikelrader.");
            Require(!await db.Orders.AnyAsync(o => o.Reference == input.Reference.Trim()), "Referensen används redan.");
            Require(input.Lines.Select(l => l.ProductId).Distinct().Count() == input.Lines.Count, "Ange varje artikel på en egen rad.");
            var order = new Order { Reference=input.Reference.Trim(), Customer=input.Customer.Trim() };
            foreach (var line in input.Lines)
            {
                await ValidateLine(line, db);
                order.Lines.Add(new OrderLine { ProductId=line.ProductId, Quantity=line.Quantity });
            }
            db.Orders.Add(order);
            return order;
        })).RequireAuthorization("Supervisor");
        api.MapPost("/orders/{id:int}/pick", (int id, ActionInput input, StockService stock, HttpContext c) =>
            stock.ProcessOrder(id,"pick",input,UserIdentity.Id(c),UserIdentity.Name(c),UserIdentity.Supervisor(c)));
        api.MapPost("/orders/{id:int}/{action}", (int id, string action, ActionInput input, StockService stock, HttpContext c) =>
            stock.ProcessOrder(id,action,input,UserIdentity.Id(c),UserIdentity.Name(c),true)).RequireAuthorization("Supervisor");
        api.MapGet("/counts", async (WarehouseDb db) => await db.Counts.Include(c => c.Lines).OrderByDescending(c => c.Id).ToListAsync()).RequireAuthorization("Supervisor");
        api.MapPost("/counts", async (CountInput input, WarehouseDb db, StockService stock) => await stock.Atomic(async () =>
        {
            Require(input.ProductId.HasValue || input.LocationId.HasValue, "Välj en artikel eller lagerplats.");
            var query = db.Balances.AsQueryable();
            if (input.ProductId.HasValue) query = query.Where(b => b.ProductId == input.ProductId);
            if (input.LocationId.HasValue) query = query.Where(b => b.LocationId == input.LocationId);
            var balances = await query.ToListAsync();
            if (balances.Count == 0 && input.ProductId.HasValue && input.LocationId.HasValue)
            {
                Require(await db.Products.AnyAsync(p => p.Id == input.ProductId) && await db.Locations.AnyAsync(l => l.Id == input.LocationId), "Välj en giltig artikel och lagerplats.");
                balances.Add(new Balance { ProductId=input.ProductId.Value, LocationId=input.LocationId.Value });
            }
            Require(balances.Count > 0, "Inga saldon hittades. Välj både artikel och lagerplats för att räkna ett nytt saldo.");
            var count = new InventoryCount { Lines = balances.Select(b => new CountLine { ProductId=b.ProductId, LocationId=b.LocationId, Expected=b.Quantity }).ToList() };
            db.Counts.Add(count);
            return count;
        })).RequireAuthorization("Supervisor");
        api.MapPost("/counts/{id:int}/record", (int id, ActionInput input, StockService stock, HttpContext c) => stock.Count(id,input,false,UserIdentity.Name(c))).RequireAuthorization("Supervisor");
        api.MapPost("/counts/{id:int}/approve", (int id, ActionInput input, StockService stock, HttpContext c) => stock.Count(id,input,true,UserIdentity.Name(c))).RequireAuthorization("Supervisor");
    }

    private static async Task ValidateLine(LineInput line, WarehouseDb db) =>
        Require(line.Quantity is > 0 and <= 100000000 && await db.Products.AnyAsync(p => p.Id == line.ProductId && p.Active), "Välj en aktiv artikel och ange ett positivt antal.");
}
