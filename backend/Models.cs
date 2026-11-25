using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

public class Supplier { public int Id {get;set;} public string Name {get;set;}=""; public string Contact {get;set;}=""; public string Email {get;set;}=""; public string Phone {get;set;}=""; public string Address {get;set;}=""; public string OrganizationNumber {get;set;}=""; public bool Active {get;set;}=true; }
public class Category { public int Id {get;set;} public string Name {get;set;}=""; }
public class Zone { public int Id {get;set;} public string Name {get;set;}=""; }
public class Product { public int Id {get;set;} public string Sku {get;set;}=""; public string Name {get;set;}=""; public string Description {get;set;}=""; public int CategoryId {get;set;} public int SupplierId {get;set;} public string Barcode {get;set;}=""; public decimal Cost {get;set;} public string Unit {get;set;}="st"; public int Minimum {get;set;} public bool Active {get;set;}=true; }
public class Location { public int Id {get;set;} public int ZoneId {get;set;} public string Code {get;set;}=""; public string Aisle {get;set;}=""; public string Shelf {get;set;}=""; public int Capacity {get;set;} public bool Active {get;set;}=true; }
public class Balance { public int ProductId {get;set;} public int LocationId {get;set;} public int Quantity {get;set;} public int Reserved {get;set;} }
public class Delivery { public int Id {get;set;} public int SupplierId {get;set;} public string Reference {get;set;}=""; public string Status {get;set;}="Planned"; public DateTime Created {get;set;}=DateTime.UtcNow; public DateTime? Completed {get;set;} public List<DeliveryLine> Lines {get;set;}=[]; }
public class DeliveryLine { public int Id {get;set;} public int ProductId {get;set;} public int LocationId {get;set;} public int Expected {get;set;} public int Received {get;set;} }
public class Order { public int Id {get;set;} public string Reference {get;set;}=""; public string Customer {get;set;}=""; public string Status {get;set;}="Waiting"; public DateTime Created {get;set;}=DateTime.UtcNow; public DateTime? Completed {get;set;} public List<OrderLine> Lines {get;set;}=[]; public PickingOrder? Picking {get;set;} }
public class OrderLine { public int Id {get;set;} public int ProductId {get;set;} public int Quantity {get;set;} }
public class PickingOrder { public int Id {get;set;} public int OrderId {get;set;} public string? AssigneeId {get;set;} public List<Reservation> Reservations {get;set;}=[]; }
public class Reservation { public int Id {get;set;} public int ProductId {get;set;} public int LocationId {get;set;} public int Quantity {get;set;} public int Picked {get;set;} }
public class InventoryCount { public int Id {get;set;} public string Status {get;set;}="Draft"; public string Reason {get;set;}=""; public DateTime Created {get;set;}=DateTime.UtcNow; public List<CountLine> Lines {get;set;}=[]; }
public class CountLine { public int Id {get;set;} public int ProductId {get;set;} public int LocationId {get;set;} public int Expected {get;set;} public int? Counted {get;set;} }
public class Movement { public int Id {get;set;} public int ProductId {get;set;} public int LocationId {get;set;} public string Type {get;set;}=""; public int Quantity {get;set;} public int Before {get;set;} public int After {get;set;} public string Reference {get;set;}=""; public string User {get;set;}=""; public string Reason {get;set;}=""; public DateTime Timestamp {get;set;}=DateTime.UtcNow; }
public class Operation { public Guid Id {get;set;} }
public class WarehouseSettings { public int Id {get;set;}=1; public string Name {get;set;}="StockFlow WMS"; }

public class WarehouseDb(DbContextOptions<WarehouseDb> options) : IdentityDbContext<IdentityUser>(options)
{
    public DbSet<Product> Products => Set<Product>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Supplier> Suppliers => Set<Supplier>();
    public DbSet<Zone> Zones => Set<Zone>();
    public DbSet<Location> Locations => Set<Location>();
    public DbSet<Balance> Balances => Set<Balance>();
    public DbSet<Delivery> Deliveries => Set<Delivery>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<InventoryCount> Counts => Set<InventoryCount>();
    public DbSet<Movement> Movements => Set<Movement>();
    public DbSet<Operation> Operations => Set<Operation>();
    public DbSet<WarehouseSettings> Settings => Set<WarehouseSettings>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        base.OnModelCreating(model);
        model.Entity<Product>().HasIndex(p => p.Sku).IsUnique();
        model.Entity<Product>().HasIndex(p => p.Barcode).IsUnique();
        model.Entity<Product>().Property(p => p.Sku).UseCollation("NOCASE");
        model.Entity<Location>().HasIndex(l => l.Code).IsUnique();
        model.Entity<Balance>().HasKey(b => new { b.ProductId, b.LocationId });
        model.Entity<Balance>().ToTable(t => t.HasCheckConstraint("CK_Balance", "Quantity >= Reserved AND Reserved >= 0"));
        model.Entity<Movement>().HasIndex(m => m.Timestamp);
        model.Entity<Product>().HasOne<Category>().WithMany().HasForeignKey(p => p.CategoryId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<Product>().HasOne<Supplier>().WithMany().HasForeignKey(p => p.SupplierId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<Location>().HasOne<Zone>().WithMany().HasForeignKey(l => l.ZoneId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<Delivery>().HasOne<Supplier>().WithMany().HasForeignKey(d => d.SupplierId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<PickingOrder>().HasOne<IdentityUser>().WithMany().HasForeignKey(p => p.AssigneeId).OnDelete(DeleteBehavior.Restrict);
        StockLinks<Balance>(); StockLinks<Movement>(); StockLinks<DeliveryLine>(); StockLinks<Reservation>(); StockLinks<CountLine>();
        model.Entity<OrderLine>().HasOne<Product>().WithMany().HasForeignKey(l => l.ProductId).OnDelete(DeleteBehavior.Restrict);

        void StockLinks<T>() where T : class
        {
            model.Entity<T>().HasOne<Product>().WithMany().HasForeignKey("ProductId").OnDelete(DeleteBehavior.Restrict);
            model.Entity<T>().HasOne<Location>().WithMany().HasForeignKey("LocationId").OnDelete(DeleteBehavior.Restrict);
        }
    }
}
