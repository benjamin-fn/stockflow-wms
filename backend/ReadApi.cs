using Microsoft.EntityFrameworkCore;

public static class ReadApi
{
    public static void Map(RouteGroupBuilder api)
    {
        api.MapGet("/transactions", async (WarehouseDb db, int? product, int? location, string? type, string? user, DateOnly? from, DateOnly? to, int page=1) =>
        {
            var query = Dates(db.Movements, from,to,m => m.Timestamp);
            if (product.HasValue) query=query.Where(m => m.ProductId == product);
            if (location.HasValue) query=query.Where(m => m.LocationId == location);
            if (!string.IsNullOrWhiteSpace(type)) query=query.Where(m => m.Type == type);
            if (!string.IsNullOrWhiteSpace(user)) query=query.Where(m => m.User.Contains(user));
            return new { total=await query.CountAsync(), items=await query.OrderByDescending(m => m.Timestamp).ThenByDescending(m => m.Id).Skip(Math.Clamp(page-1,0,100000)*12).Take(12).ToListAsync() };
        });
        api.MapGet("/dashboard", async (WarehouseDb db) =>
        {
            var products=await db.Products.ToListAsync();
            var categories=await db.Categories.ToListAsync();
            var balances=await db.Balances.ToListAsync();
            var zones=await db.Zones.ToListAsync();
            var locations=await db.Locations.Where(l => l.Active).ToListAsync();
            var orders=await db.Orders.ToListAsync();
            var today=TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, SwedishTime).Date;
            var start=LocalMidnight(DateOnly.FromDateTime(today));
            var end=LocalMidnight(DateOnly.FromDateTime(today.AddDays(1)));
            var movements=await db.Movements.Where(m => m.Timestamp >= LocalMidnight(DateOnly.FromDateTime(today.AddDays(-6))) && m.Timestamp < end).ToListAsync();
            var stock=products.Select(p => new { product=p, quantity=balances.Where(b => b.ProductId==p.Id).Sum(b => b.Quantity) }).ToList();
            var alerts=stock.Where(x => x.product.Active && x.quantity < x.product.Minimum).OrderBy(x => x.quantity).ToList();
            return new {
                articles=products.Count(p => p.Active), quantity=stock.Sum(x => (long)x.quantity), value=stock.Sum(x => x.quantity*x.product.Cost), low=alerts.Count,
                incoming=await db.Deliveries.CountAsync(d => d.Completed >= start && d.Completed < end),
                outgoing=orders.Count(o => o.Completed >= start && o.Completed < end),
                picking=orders.Count(o => o.Status is "Reserved" or "Picking" or "Picked"),
                alerts=alerts.Take(5), recent=await db.Movements.OrderByDescending(m => m.Timestamp).ThenByDescending(m => m.Id).Take(6).ToListAsync(),
                categories=categories.Select(c => new {c.Name, quantity=stock.Where(x=>x.product.CategoryId==c.Id).Sum(x=>x.quantity)}),
                statuses=orders.GroupBy(o=>o.Status).Select(g=>new { status=g.Key, quantity=g.Count() }),
                utilization=zones.Select(z => {
                    var bins=locations.Where(l=>l.ZoneId==z.Id).ToList();
                    return new {z.Name, capacity=bins.Sum(l=>l.Capacity), quantity=balances.Where(b=>bins.Any(l=>l.Id==b.LocationId)).Sum(b=>b.Quantity)};
                }),
                activity=Enumerable.Range(-6,7).Select(offset => {
                    var day=DateOnly.FromDateTime(today.AddDays(offset));
                    var first=LocalMidnight(day); var last=LocalMidnight(day.AddDays(1));
                    var rows=movements.Where(m=>m.Timestamp>=first && m.Timestamp<last);
                    return new { date=day.ToString("yyyy-MM-dd"), incoming=rows.Where(m=>m.Type=="Receipt").Sum(m=>m.Quantity), outgoing=-rows.Where(m=>m.Type=="Shipment").Sum(m=>m.Quantity) };
                })
            };
        });
        api.MapGet("/reports/{kind}", Report).RequireAuthorization("Supervisor");
    }

    static readonly TimeZoneInfo SwedishTime = TimeZoneInfo.FindSystemTimeZoneById("Europe/Stockholm");
    static DateTime LocalMidnight(DateOnly day) => TimeZoneInfo.ConvertTimeToUtc(day.ToDateTime(TimeOnly.MinValue), SwedishTime);
    static IQueryable<T> Dates<T>(IQueryable<T> query, DateOnly? from, DateOnly? to, System.Linq.Expressions.Expression<Func<T,DateTime>> field)
    {
        if (from.HasValue) query=query.Where(Comparison(LocalMidnight(from.Value), System.Linq.Expressions.ExpressionType.GreaterThanOrEqual));
        if (to.HasValue && to.Value < DateOnly.MaxValue) query=query.Where(Comparison(LocalMidnight(to.Value.AddDays(1)), System.Linq.Expressions.ExpressionType.LessThan));
        return query;
        System.Linq.Expressions.Expression<Func<T,bool>> Comparison(DateTime date, System.Linq.Expressions.ExpressionType type) =>
            System.Linq.Expressions.Expression.Lambda<Func<T,bool>>(System.Linq.Expressions.Expression.MakeBinary(type,field.Body,System.Linq.Expressions.Expression.Constant(date)),field.Parameters);
    }

    static async Task<IResult> Report(string kind, DateOnly? from, DateOnly? to, WarehouseDb db)
    {
        var products=await db.Products.ToDictionaryAsync(p=>p.Id);
        var locations=await db.Locations.ToDictionaryAsync(l=>l.Id,l=>l.Code);
        var culture=System.Globalization.CultureInfo.GetCultureInfo("sv-SE");
        string[] headers;
        IEnumerable<string[]> rows;
        switch (kind)
        {
            case "value":
            case "low":
                headers=["Artikelnummer","Artikel","Saldo","Minsta saldo","Lagervärde (SEK)"];
                var movements=await Dates(db.Movements,null,to,m=>m.Timestamp).ToListAsync();
                var balances=to.HasValue ? movements.GroupBy(m=>m.ProductId).ToDictionary(g=>g.Key,g=>g.Sum(m=>m.Quantity)) :
                    (await db.Balances.ToListAsync()).GroupBy(b=>b.ProductId).ToDictionary(g=>g.Key,g=>g.Sum(b=>b.Quantity));
                rows=products.Values.OrderBy(p=>p.Sku).Where(p=>kind=="value" || p.Active && balances.GetValueOrDefault(p.Id)<p.Minimum).Select(p=>new[] {p.Sku,p.Name,balances.GetValueOrDefault(p.Id).ToString(culture),p.Minimum.ToString(culture),(balances.GetValueOrDefault(p.Id)*p.Cost).ToString("F2",culture)});
                break;
            case "movements":
                headers=["Datum","Artikel","Lagerplats","Förändring","Referens","Användare"];
                rows=(await Dates(db.Movements,from,to,m=>m.Timestamp).OrderByDescending(m=>m.Timestamp).ToListAsync()).Select(m=>new[]{Day(m.Timestamp),products[m.ProductId].Name,locations[m.LocationId],m.Quantity.ToString(culture),m.Reference,m.User});
                break;
            case "deliveries":
                headers=["Datum","Typ","Referens","Status","Antal"];
                var receipts=await Dates(db.Deliveries.Include(d=>d.Lines),from,to,d=>d.Created).ToListAsync();
                var shipments=await Dates(db.Orders.Include(o=>o.Lines),from,to,o=>o.Created).ToListAsync();
                rows=receipts.Select(d=>new[]{Day(d.Created),"Inleverans",d.Reference,Status(d.Status),d.Lines.Sum(l=>l.Received).ToString(culture)})
                    .Concat(shipments.Select(o=>new[]{Day(o.Created),"Utleverans",o.Reference,Status(o.Status),o.Lines.Sum(l=>l.Quantity).ToString(culture)}));
                break;
            case "picking":
                headers=["Datum","Referens","Status","Reserverat vid plockstart","Plockat"];
                rows=(await Dates(db.Orders.Where(o=>o.Picking!=null).Include(o=>o.Picking).ThenInclude(p=>p!.Reservations),from,to,o=>o.Created).ToListAsync())
                    .Select(o=>new[]{Day(o.Created),o.Reference,Status(o.Status),o.Picking!.Reservations.Sum(r=>r.Quantity).ToString(culture),o.Picking.Reservations.Sum(r=>r.Picked).ToString(culture)});
                break;
            case "counts":
                headers=["Datum","Artikel","Plats","Förväntat","Räknat","Avvikelse","Orsak"];
                rows=(await Dates(db.Counts.Include(c=>c.Lines),from,to,c=>c.Created).ToListAsync()).SelectMany(c=>c.Lines.Where(l=>l.Counted!=null && l.Counted!=l.Expected)
                    .Select(l=>new[]{Day(c.Created),products[l.ProductId].Name,locations[l.LocationId],l.Expected.ToString(culture),l.Counted!.Value.ToString(culture),(l.Counted.Value-l.Expected).ToString(culture),c.Reason}));
                break;
            default: return Results.NotFound();
        }
        return Results.Ok(new { headers, rows });
    }

    static string Day(DateTime date) => TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(date,DateTimeKind.Utc),SwedishTime).ToString("yyyy-MM-dd");
    static string Status(string value) => value switch {
        "Planned"=>"Planerad","InProgress"=>"Pågående","Partial"=>"Dellevererad","Completed"=>"Slutförd",
        "Waiting"=>"Väntar","Reserved"=>"Reserverad","Picking"=>"Plockning pågår","Picked"=>"Färdigplockad","Shipped"=>"Skickad","Cancelled"=>"Avbruten",_=>value
    };
}
