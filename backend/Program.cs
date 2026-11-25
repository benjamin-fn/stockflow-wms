using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddDbContext<WarehouseDb>(o => o.UseSqlite(builder.Configuration.GetConnectionString("Warehouse") ?? "Data Source=stockflow.db;Foreign Keys=True;Default Timeout=15"));
builder.Services.AddIdentity<IdentityUser, IdentityRole>().AddEntityFrameworkStores<WarehouseDb>();
builder.Services.ConfigureApplicationCookie(o =>
{
    o.Cookie.Name = "StockFlow.Session";
    o.Cookie.SameSite = SameSiteMode.Strict;
    o.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
    o.LoginPath = "/api/auth/login";
    o.Events.OnRedirectToLogin = c => { c.Response.StatusCode = 401; return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = c => { c.Response.StatusCode = 403; return Task.CompletedTask; };
});
builder.Services.Configure<SecurityStampValidatorOptions>(o => o.ValidationInterval = TimeSpan.Zero);
builder.Services.AddAuthorization(o =>
{
    o.AddPolicy("Supervisor", p => p.RequireRole("Administrator", "Supervisor"));
    o.AddPolicy("Administrator", p => p.RequireRole("Administrator"));
});
builder.Services.AddAntiforgery(o => o.HeaderName = "X-CSRF-TOKEN");
builder.Services.AddScoped<StockService>();
builder.Services.AddOpenApi();
var app = builder.Build();
app.UseExceptionHandler(handler => handler.Run(context => Results.Problem("Ett oväntat fel uppstod.", statusCode:500).ExecuteAsync(context)));
if (app.Environment.IsDevelopment()) app.MapOpenApi();
app.UseAuthentication();
app.UseAuthorization();
app.Use(async (context, next) =>
{
    try
    {
        if (context.Request.Path.StartsWithSegments("/api") && !HttpMethods.IsGet(context.Request.Method))
            await context.RequestServices.GetRequiredService<IAntiforgery>().ValidateRequestAsync(context);
        await next(context);
    }
    catch (AntiforgeryValidationException) { await Results.Problem("Uppdatera sidan och försök igen.", statusCode:400).ExecuteAsync(context); }
    catch (RuleException e) { await Results.Problem(e.Message, statusCode:e.Status).ExecuteAsync(context); }
    catch (DbUpdateException) { await Results.Problem("Ändringen kunde inte sparas. Kontrollera uppgifterna och försök igen.", statusCode:409).ExecuteAsync(context); }
    catch (BadHttpRequestException) { await Results.Problem("Kontrollera de angivna uppgifterna.", statusCode:400).ExecuteAsync(context); }
    catch (SqliteException e) when (e.SqliteErrorCode is 5 or 6) { await Results.Problem("Lagret används just nu. Försök igen.", statusCode:409).ExecuteAsync(context); }
});
app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));
app.MapGet("/api/auth/csrf", (HttpContext c, IAntiforgery csrf) =>
{
    c.Response.Headers.CacheControl = "no-store";
    return new { token = csrf.GetAndStoreTokens(c).RequestToken };
});
app.MapPost("/api/auth/login", async (LoginInput input, SignInManager<IdentityUser> signIn) =>
{
    var result = await signIn.PasswordSignInAsync(input.Username, input.Password, false, true);
    return result.Succeeded ? Results.Ok() : Results.Problem("Fel användarnamn eller lösenord, eller kontot är låst.", statusCode:401);
});
var api = app.MapGroup("/api").RequireAuthorization();
api.MapGet("/auth/me", (HttpContext c) => new { id = UserIdentity.Id(c), username = c.User.Identity!.Name, role = c.User.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value });
api.MapPost("/auth/logout", async (HttpContext c, SignInManager<IdentityUser> signIn, UserManager<IdentityUser> users) =>
{
    var user = await users.GetUserAsync(c.User);
    if (user is not null) await users.UpdateSecurityStampAsync(user);
    await signIn.SignOutAsync();
    return Results.Ok();
});
CatalogApi.Map(api);
WorkflowApi.Map(api);
ReadApi.Map(api);
await using (var scope = app.Services.CreateAsyncScope())
{
    var db = scope.ServiceProvider.GetRequiredService<WarehouseDb>();
    await db.Database.MigrateAsync();
    await DemoData.Initialize(scope.ServiceProvider, app.Environment.IsDevelopment() && builder.Configuration.GetValue("SeedDemo", true));
}
await app.RunAsync();

public record LoginInput(string Username, string Password);
public partial class Program;
public static class UserIdentity
{
    public static string Id(HttpContext context) => context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)!.Value;
    public static string Name(HttpContext context) => context.User.Identity!.Name!;
    public static bool Supervisor(HttpContext context) => context.User.IsInRole("Administrator") || context.User.IsInRole("Supervisor");
}
