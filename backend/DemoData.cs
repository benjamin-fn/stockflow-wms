using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

public static class DemoData
{
    public const string Password = "StockFlow!2026";
    public static async Task Initialize(IServiceProvider services, bool seed)
    {
        var roles=services.GetRequiredService<RoleManager<IdentityRole>>();
        foreach(var role in CatalogApi.Roles)
            if (!await roles.RoleExistsAsync(role)) Check(await roles.CreateAsync(new IdentityRole(role)));
        if (!seed) return;
        var db=services.GetRequiredService<WarehouseDb>();
        var users=services.GetRequiredService<UserManager<IdentityUser>>();
        var stock=services.GetRequiredService<StockService>();
        var accountNames=new[]{"admin","arbetsledare","lager"};
        var accounts=new List<IdentityUser>();
        for(var i=0;i<accountNames.Length;i++)
        {
            var user=await users.FindByNameAsync(accountNames[i]);
            if (user is null)
            {
                user=new IdentityUser(accountNames[i]){LockoutEnabled=true};
                Check(await users.CreateAsync(user,Password));
                Check(await users.AddToRoleAsync(user,CatalogApi.Roles[i]));
            }
            accounts.Add(user);
        }
        if(await db.Products.AnyAsync()) return;
        await stock.Atomic(async () =>
        {
            var names=new[]{"Emballage","Förbrukning","Skyddsutrustning","Lagerinredning","Materialhantering"};
            var productNames=new[]{
                new[]{"Wellåda dubbelwell","Bubbelplast","Pappersfyllnad","Packtejp brun","Pallhuv transparent","Sträckfilm","Kantskydd papp","Skumfolie","Kuvert vadderat","Packpapper","Pallkrage","Kartongark"},
                new[]{"Termoetikett","Märkpenna svart","Följesedelsficka","Säkerhetskniv","Knivblad","Avspärrningstejp","Buntband","Etiketthållare","Skrivarrulle","Kabelmärkning","Städduk","Färgbandsrulle"},
                new[]{"Monteringshandske","Skyddsglasögon","Varselväst","Hörselproppar","Knäskydd","Skyddsmask","Vinterhandske","Skärskyddshandske","Första hjälpen-kit","Ögondusch","Skyddsförkläde","Hörselkåpa"},
                new[]{"Plastback låg","Hyllavdelare","Magnetetikett","Smådelslåda","Hyllplan stål","Pallställsskydd","Golvmarkering","Hängback","Verktygstavla","Plocklåda","Trådhylla","Lagerlåda blå"},
                new[]{"Pallöverdrag","Lastrem","Transporthjul","Spännband","Lyftstropp","Friktionsmatta","Pallvagn","Rullcontainer","Draghandtag","Glidskena","Skyddsmatta","Lastnät"}
            };
            var categories=names.Select(n=>new Category{Name=n}).ToArray();
            var suppliers=new[]{"Fjordvik Emballage AB","Tallspår Industrivaror AB","Sunnanport Lagerteknik AB","Myrängen Skydd & Profil AB","Granudden Material AB"}.Select((name,i)=>new Supplier{Name=name,Contact=new[]{"Sam Lind","Kim Bro","Alex Strand","Robin Sjö","Charlie Berg"}[i],Email=$"order{i+1}@lager.example",Phone=$"010-000 00 0{i+1}",Address=$"Demovägen {i+1}, Exempelstad",OrganizationNumber=$"DEMO-{100+i}"}).ToArray();
            var zones=new[]{"A · Plockzon","B · Pallager","C · Emballage","D · Buffertlager"}.Select(n=>new Zone{Name=n}).ToArray();
            db.AddRange(categories); db.AddRange(suppliers); db.AddRange(zones); await db.SaveChangesAsync();
            var locations=zones.SelectMany((z,index)=>Enumerable.Range(1,4).Select(i=>new Location{ZoneId=z.Id,Code=$"{(char)('A'+index)}-{i:D2}-01",Aisle=$"{i:D2}",Shelf="01",Capacity=1000+index*200})).ToArray();
            var products=categories.SelectMany((c,g)=>productNames[g].Select((n,i)=>new Product{CategoryId=c.Id,SupplierId=suppliers[g].Id,Name=n,Sku=$"SF-{1001+g*12+i}",Barcode=$"7310000{1001+g*12+i}",Cost=12.5m+(g*12+i)*8.75m,Minimum=25+(i%3)*5,Description=$"{n} för daglig lagerdrift.",Unit="st"})).ToArray();
            db.AddRange(locations); db.AddRange(products); await db.SaveChangesAsync();
            var today=DateTime.UtcNow;
            for(var i=0;i<products.Length;i++)
            {
                var product=products[i]; var location=locations[i%locations.Length];
                var quantity=i%9==0 ? 8+i%11 : 48+(i*29)%135;
                var shipped=i%9==0 ? 0 : 7+i%13;
                var reserved=i is 1 or 2 or 3 ? 12 : 0;
                var balance = new Balance{ProductId=product.Id,LocationId=location.Id,Quantity=quantity,Reserved=reserved};
                db.Balances.Add(balance);
                var date=today.Date.AddDays(-(i%7)).AddHours(8);
                if(date>today) date=today;
                var receipt=new Delivery{SupplierId=product.SupplierId,Reference=$"IN-{2100+i}",Status="Completed",Created=date.AddDays(-1),Completed=date,Lines=[new DeliveryLine{ProductId=product.Id,LocationId=location.Id,Expected=quantity+shipped,Received=quantity+shipped}]};
                db.Deliveries.Add(receipt);
                db.Movements.Add(new Movement{ProductId=product.Id,LocationId=location.Id,Type="Receipt",Quantity=quantity+shipped,After=quantity+shipped,Reference=receipt.Reference,User="lager",Timestamp=date});
                if(shipped>0)
                {
                    var order=new Order{Reference=$"UT-{3100+i}",Customer="Kund "+(100+i%8),Status="Shipped",Created=date,Completed=date,Lines=[new OrderLine{ProductId=product.Id,Quantity=shipped}],Picking=new PickingOrder{AssigneeId=accounts[2].Id,Reservations=[new Reservation{ProductId=product.Id,LocationId=location.Id,Quantity=shipped,Picked=shipped}]}};
                    db.Orders.Add(order);
                    db.Movements.Add(new Movement{ProductId=product.Id,LocationId=location.Id,Type="Shipment",Quantity=-shipped,Before=quantity+shipped,After=quantity,Reference=order.Reference,User="arbetsledare",Timestamp=date});
                }
                if(reserved>0)
                    db.Orders.Add(new Order{Reference=$"UT-{3300+i}",Customer=new[]{"","Björkbacka Handel","Stenbro Verkstad","Ekvik Butik"}[i],Status=new[]{"","Reserved","Picking","Picked"}[i],Lines=[new OrderLine{ProductId=product.Id,Quantity=reserved}],Picking=new PickingOrder{AssigneeId=accounts[2].Id,Reservations=[new Reservation{ProductId=product.Id,LocationId=location.Id,Quantity=reserved,Picked=i==1?0:i==2?5:12}]}});
                if(i is 6 or 7)
                    db.Deliveries.Add(new Delivery{SupplierId=product.SupplierId,Reference=$"IN-{2300+i}",Status=i==6?"Planned":"InProgress",Lines=[new DeliveryLine{ProductId=product.Id,LocationId=location.Id,Expected=40}]});
            }
            db.Counts.Add(new InventoryCount{Lines=[new CountLine{ProductId=products[0].Id,LocationId=locations[0].Id,Expected=8,Counted=7}]});
            return true;
        });
    }

    static void Check(IdentityResult result)
    {
        if (!result.Succeeded) throw new InvalidOperationException(string.Join(", ",result.Errors.Select(e=>e.Code)));
    }
}
