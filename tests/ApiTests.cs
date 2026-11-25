using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Xunit;

public class WarehouseFactory : WebApplicationFactory<Program>
{
    readonly string database = Path.Combine(Path.GetTempPath(), $"stockflow-tests-{Guid.NewGuid():N}.db");
    protected override void ConfigureWebHost(IWebHostBuilder builder) => builder.UseEnvironment("Development")
        .ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string,string?>
        {
            ["ConnectionStrings:Warehouse"] = $"Data Source={database};Foreign Keys=True;Pooling=False"
        }));
    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        File.Delete(database);
    }
}

public class ApiTests(WarehouseFactory factory) : IClassFixture<WarehouseFactory>
{
    HttpClient Client() => factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect=false });

    static async Task<HttpResponseMessage> Write(HttpClient client,string path,object body)
    {
        var csrf=await client.GetFromJsonAsync<JsonElement>("/api/auth/csrf");
        using var request=new HttpRequestMessage(HttpMethod.Post,"/api"+path){Content=JsonContent.Create(body)};
        request.Headers.Add("X-CSRF-TOKEN",csrf.GetProperty("token").GetString());
        return await client.SendAsync(request);
    }

    static async Task Login(HttpClient client,string username) =>
        Assert.Equal(HttpStatusCode.OK,(await Write(client,"/auth/login",new {username,password=DemoData.Password})).StatusCode);

    static async Task<JsonElement> Ok(Task<HttpResponseMessage> pending)
    {
        using var response=await pending;
        Assert.True(response.IsSuccessStatusCode,await response.Content.ReadAsStringAsync());
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    static object Command(object[]? lines=null,string? reason=null,Guid? operationId=null,string? assigneeId=null) =>
        new {operationId=operationId??Guid.NewGuid(), lines, reason, assigneeId};
    static int Id(JsonElement data) => data.GetProperty("id").GetInt32();
    static int FirstLine(JsonElement data) => Id(data.GetProperty("lines")[0]);
    static async Task<int> Quantity(HttpClient client,int product,string field="quantity") =>
        (await client.GetFromJsonAsync<JsonElement>($"/api/products/{product}")).GetProperty(field).GetInt32();

    [Theory]
    [InlineData("admin","Administrator")]
    [InlineData("arbetsledare","Supervisor")]
    [InlineData("lager","Worker")]
    public async Task IdentityAndPermissions(string username,string role)
    {
        using var client=Client();
        Assert.Equal(HttpStatusCode.Unauthorized,(await client.GetAsync("/api/products")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/auth/login",new {username,password=DemoData.Password})).StatusCode);
        await Login(client,username);
        var session=await client.GetFromJsonAsync<JsonElement>("/api/auth/me");
        Assert.Equal(role,session.GetProperty("role").GetString());
        Assert.Equal(role=="Administrator"?HttpStatusCode.OK:HttpStatusCode.Forbidden,(await client.GetAsync("/api/users")).StatusCode);
        Assert.Equal(role=="Worker"?HttpStatusCode.Forbidden:HttpStatusCode.OK,(await client.GetAsync("/api/reports/value")).StatusCode);
        Assert.Equal(HttpStatusCode.OK,(await Write(client,"/auth/logout",new {})).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,(await client.GetAsync("/api/products")).StatusCode);
    }

    [Fact]
    public async Task WarehouseLifecyclePreservesBalances()
    {
        using var admin=Client();
        using var worker=Client();
        await Login(admin,"admin");
        await Login(worker,"lager");
        var employee=await worker.GetFromJsonAsync<JsonElement>("/api/auth/me");
        var sku="TEST-"+Guid.NewGuid().ToString("N");
        object Product(string name) => new {sku,name,unit="st",categoryId=1,supplierId=1,cost=42.25m,minimum=3};
        Assert.Equal(HttpStatusCode.Forbidden,(await Write(worker,"/products",Product("Testartikel"))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await Write(admin,"/products",Product(""))).StatusCode);
        var product=Id(await Ok(Write(admin,"/products",Product("Testartikel"))));
        Assert.Equal(HttpStatusCode.Conflict,(await Write(admin,"/products",Product("Dubblett"))).StatusCode);

        var receipt=await Ok(Write(worker,"/deliveries",new {reference=sku+"-IN",supplierId=1,lines=new[]{new {productId=product,locationId=1,quantity=20}}}));
        var receiptPath=$"/deliveries/{Id(receipt)}";
        var key=Guid.NewGuid();
        object[] Receipt(int quantity)=>[new{lineId=FirstLine(receipt),quantity}];
        var partial=await Ok(Write(worker,receiptPath+"/receive",Command(Receipt(8),operationId:key)));
        Assert.Equal("Partial",partial.GetProperty("status").GetString());
        Assert.Equal(HttpStatusCode.Conflict,(await Write(worker,receiptPath+"/receive",Command(Receipt(8),operationId:key))).StatusCode);
        Assert.Equal(8,await Quantity(admin,product));
        await Ok(Write(worker,receiptPath+"/complete",Command(Receipt(12))));
        Assert.Equal(20,await Quantity(admin,product));

        var move=await Write(worker,"/transfers",new{productId=product,from=1,to=2,quantity=6,operationId=Guid.NewGuid()});
        Assert.Equal(HttpStatusCode.OK,move.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await Write(worker,"/transfers",new{productId=product,from=1,to=2,quantity=15,operationId=Guid.NewGuid()})).StatusCode);
        Assert.Equal(20,await Quantity(admin,product));

        async Task<string> Order(string suffix,int quantity) => "/orders/"+Id(await Ok(Write(admin,"/orders",new{reference=sku+suffix,customer="Testkund",lines=new[]{new{productId=product,quantity}}})));
        var order=await Order("-UT",16);
        var reserved=await Ok(Write(admin,order+"/reserve",Command()));
        Assert.Equal(20,await Quantity(admin,product));
        Assert.Equal(4,await Quantity(admin,product,"available"));
        var second=await Order("-C",5);
        Assert.Equal(HttpStatusCode.Conflict,(await Write(admin,second+"/reserve",Command())).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await Write(admin,order+"/ship",Command())).StatusCode);

        var count=await Ok(Write(admin,"/counts",new{productId=product,locationId=1}));
        var countPath="/counts/"+Id(count);
        await Ok(Write(admin,countPath+"/record",Command([new{lineId=FirstLine(count),quantity=10}])));
        Assert.Equal(HttpStatusCode.Conflict,(await Write(admin,countPath+"/approve",Command(reason:"Kontrollräkning"))).StatusCode);
        var picks=reserved.GetProperty("picking").GetProperty("reservations").EnumerateArray().Select(l=>(object)new{lineId=Id(l),quantity=l.GetProperty("quantity").GetInt32()}).ToArray();
        Assert.Equal(HttpStatusCode.Forbidden,(await Write(worker,order+"/pick",Command(picks))).StatusCode);
        await Ok(Write(admin,order+"/assign",Command(assigneeId:employee.GetProperty("id").GetString())));
        await Ok(Write(worker,order+"/pick",Command(picks)));
        await Ok(Write(admin,order+"/ship",Command()));
        Assert.Equal(4,await Quantity(admin,product));
        Assert.Equal(0,await Quantity(admin,product,"reserved"));
        Assert.Equal(HttpStatusCode.Conflict,(await Write(admin,order+"/ship",Command())).StatusCode);

        var third=await Order("-REL",3);
        await Ok(Write(admin,third+"/reserve",Command()));
        await Ok(Write(admin,third+"/cancel",Command()));
        Assert.Equal(4,await Quantity(admin,product,"available"));
        var net=await Ok(Write(admin,"/counts",new{productId=product,locationId=2}));
        var netPath="/counts/"+Id(net);
        await Ok(Write(admin,netPath+"/record",Command([new{lineId=FirstLine(net),quantity=3}])));
        Assert.Equal(HttpStatusCode.Conflict,(await Write(admin,netPath+"/approve",Command())).StatusCode);
        await Ok(Write(admin,netPath+"/approve",Command(reason:"Kontrollräkning")));
        Assert.Equal(3,await Quantity(admin,product));
        var history=await admin.GetFromJsonAsync<JsonElement>($"/api/transactions?product={product}&type=Adjustment");
        Assert.Equal(1,history.GetProperty("total").GetInt32());
        Assert.Equal("Kontrollräkning",history.GetProperty("items")[0].GetProperty("reason").GetString());
        Assert.True((await admin.GetFromJsonAsync<JsonElement>("/api/dashboard")).GetProperty("articles").GetInt32()>60);
    }

    [Fact]
    public async Task CapacityAndConcurrentReservationsAreAtomic()
    {
        using var admin = Client();
        using var supervisor = Client();
        await Login(admin, "admin");
        await Login(supervisor, "arbetsledare");
        var sku = "RACE-" + Guid.NewGuid().ToString("N");
        var product = Id(await Ok(Write(admin, "/products", new { sku, name = "Kapacitetsartikel", unit = "st", categoryId = 1, supplierId = 1 })));
        var bin = Id(await Ok(Write(admin, "/locations", new { code = sku, zoneId = 1, aisle = "01", shelf = "02", capacity = 10 })));
        var delivery = await Ok(Write(admin, "/deliveries", new {
            reference = sku, supplierId = 1,
            lines = new[] { new { productId = product, locationId = bin, quantity = 11 } }
        }));
        var path = $"/deliveries/{Id(delivery)}/receive";
        Assert.Equal(HttpStatusCode.Conflict, (await Write(admin, path, Command([new { lineId = FirstLine(delivery), quantity = 11 }]))).StatusCode);
        Assert.Equal(0, await Quantity(admin, product));
        await Ok(Write(admin, path, Command([new { lineId = FirstLine(delivery), quantity = 10 }])));
        async Task<string> NewOrder(string suffix) => "/orders/" + Id(await Ok(Write(admin, "/orders", new {
            reference = sku + suffix, customer = "Testkund", lines = new[] { new { productId = product, quantity = 7 } }
        }))) + "/reserve";
        var first = await NewOrder("-1");
        var second = await NewOrder("-2");
        var results = await Task.WhenAll(Write(admin, first, Command()), Write(supervisor, second, Command()));
        Assert.Single(results, response => response.StatusCode == HttpStatusCode.OK);
        Assert.Single(results, response => response.StatusCode == HttpStatusCode.Conflict);
        Assert.Equal(10, await Quantity(admin, product));
        Assert.Equal(7, await Quantity(admin, product, "reserved"));
        foreach (var response in results) response.Dispose();
    }
}
