using Microsoft.EntityFrameworkCore;

public record LineInput(int ProductId, int LocationId, int Quantity);
public record LineQuantity(int LineId, int Quantity);
public record ActionInput(Guid OperationId, List<LineQuantity>? Lines, string? Reason, string? AssigneeId);
public class RuleException(string message, int status = 409) : Exception(message) { public int Status { get; } = status; }

public class StockService(WarehouseDb db)
{
    public static void Require(bool condition, string message)
    {
        if (!condition) throw new RuleException(message);
    }

    public async Task<T> Atomic<T>(Func<Task<T>> change, Guid? key = null)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
        if (key.HasValue)
        {
            Require(key.Value != Guid.Empty, "Åtgärden saknar ett giltigt åtgärds-ID.");
            Require(!await db.Operations.AnyAsync(o => o.Id == key), "Åtgärden har redan registrerats.");
            db.Operations.Add(new Operation { Id = key.Value });
        }
        var result = await change();
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return result;
    }

    public async Task Change(int product, int location, int delta, string type, string reference, string user, string reason = "")
    {
        var bin = await db.Locations.FindAsync(location);
        Require(bin is not null && (delta <= 0 || bin.Active), "Lagerplatsen är inte tillgänglig.");
        var balance = await db.Balances.FindAsync(product, location);
        if (balance is null)
        {
            balance = new Balance { ProductId = product, LocationId = location };
            db.Balances.Add(balance);
        }
        var next = (long)balance.Quantity + delta;
        Require(next >= balance.Reserved && next <= int.MaxValue, "Ändringen ryms inte inom tillgängligt saldo.");
        if (delta > 0)
        {
            var occupied = await db.Balances.Where(b => b.LocationId == location).SumAsync(b => (long)b.Quantity);
            occupied += db.ChangeTracker.Entries<Balance>().Where(e => e.Entity.LocationId == location)
                .Sum(e => (long)e.Entity.Quantity - (e.State == EntityState.Added ? 0 : e.OriginalValues.GetValue<int>(nameof(Balance.Quantity))));
            Require(occupied + delta <= bin!.Capacity, "Lagerplatsens kapacitet skulle överskridas.");
        }
        if (delta == 0) return;
        db.Movements.Add(new Movement { ProductId=product, LocationId=location, Quantity=delta, Before=balance.Quantity,
            After=(int)next, Reference=reference, Type=type, User=user, Reason=reason });
        balance.Quantity = (int)next;
    }

    public Task<bool> Transfer(int product, int from, int to, int quantity, Guid key, string user) => Atomic(async () =>
    {
        Require(from != to && quantity > 0, "Välj två olika lagerplatser och ett positivt antal.");
        await Change(product, from, -quantity, "TransferOut", key.ToString(), user);
        await Change(product, to, quantity, "TransferIn", key.ToString(), user);
        return true;
    }, key);

    public Task<Delivery> Receive(int id, string action, ActionInput input, string user) => Atomic(async () =>
    {
        var delivery = await db.Deliveries.Include(d => d.Lines).SingleOrDefaultAsync(d => d.Id == id)
            ?? throw new RuleException("Inleveransen finns inte.");
        Require(delivery.Status is "Planned" or "InProgress" or "Partial", "Inleveransen är stängd.");
        if (action == "start")
        {
            Require(delivery.Status == "Planned", "Inleveransen har redan påbörjats.");
            delivery.Status = "InProgress";
        }
        else if (action == "cancel")
        {
            Require(delivery.Lines.All(l => l.Received == 0), "En mottagen inleverans kan inte avbrytas.");
            delivery.Status = "Cancelled";
        }
        else
        {
            Require(action is "receive" or "complete", "Ogiltig åtgärd.");
            var lines = input.Lines ?? [];
            Require(lines.Select(l => l.LineId).Distinct().Count() == lines.Count, "Varje rad får anges en gång.");
            foreach (var row in lines)
            {
                var line = delivery.Lines.SingleOrDefault(l => l.Id == row.LineId) ?? throw new RuleException("Leveransraden finns inte.");
                Require(row.Quantity >= 0 && row.Quantity <= line.Expected - line.Received, "Ange ett antal inom återstående leverans.");
                await Change(line.ProductId, line.LocationId, row.Quantity, "Receipt", delivery.Reference, user);
                line.Received += row.Quantity;
            }
            var complete = delivery.Lines.All(l => l.Received == l.Expected);
            Require(action != "complete" || complete, "Registrera återstående antal innan leveransen slutförs.");
            Require(complete || lines.Any(l => l.Quantity > 0), "Ange antal mottagna enheter.");
            delivery.Status = complete ? "Completed" : "Partial";
            if (complete) delivery.Completed = DateTime.UtcNow;
        }
        return delivery;
    }, input.OperationId);

    public Task<Order> ProcessOrder(int id, string action, ActionInput input, string userId, string user, bool supervisor) => Atomic(async () =>
    {
        var order = await db.Orders.Include(o => o.Lines).Include(o => o.Picking).ThenInclude(p => p!.Reservations)
            .SingleOrDefaultAsync(o => o.Id == id) ?? throw new RuleException("Utleveransen finns inte.");
        var picking = order.Picking;
        switch (action)
        {
            case "reserve":
                Require(order.Status == "Waiting", "Ordern väntar inte på reservation.");
                picking = new PickingOrder();
                foreach (var line in order.Lines)
                {
                    var available = await (from balance in db.Balances join bin in db.Locations on balance.LocationId equals bin.Id
                        where balance.ProductId == line.ProductId && bin.Active orderby bin.Code select balance).ToListAsync();
                    var remaining = line.Quantity;
                    foreach (var balance in available)
                    {
                        var amount = Math.Min(remaining, balance.Quantity - balance.Reserved);
                        if (amount == 0) continue;
                        balance.Reserved += amount;
                        picking.Reservations.Add(new Reservation { ProductId=line.ProductId, LocationId=balance.LocationId, Quantity=amount });
                        remaining -= amount;
                        if (remaining == 0) break;
                    }
                    Require(remaining == 0, "Det finns inte tillräckligt med tillgängligt saldo.");
                }
                order.Picking = picking;
                order.Status = "Reserved";
                break;
            case "assign":
                Require(picking is not null && order.Status is "Reserved" or "Picking", "Ordern kan inte tilldelas.");
                var assignee = input.AssigneeId is null ? null : await db.Users.FindAsync(input.AssigneeId);
                Require(assignee is not null && (assignee.LockoutEnd is null || assignee.LockoutEnd <= DateTimeOffset.UtcNow), "Användaren är inte tillgänglig.");
                picking!.AssigneeId = input.AssigneeId;
                break;
            case "pick":
                Require(picking is not null && order.Status is "Reserved" or "Picking", "Ordern är inte redo för plockning.");
                if (!supervisor && picking?.AssigneeId != userId) throw new RuleException("Plocklistan är inte tilldelad dig.",403);
                var quantities = input.Lines ?? [];
                Require(quantities.Count > 0 && quantities.Select(l => l.LineId).Distinct().Count() == quantities.Count, "Ange varje plockrad en gång.");
                foreach (var row in quantities)
                {
                    var line = picking!.Reservations.SingleOrDefault(r => r.Id == row.LineId) ?? throw new RuleException("Plockraden finns inte.");
                    Require(row.Quantity >= 0 && row.Quantity <= line.Quantity, "Plockat antal måste rymmas inom reservationen.");
                    line.Picked = row.Quantity;
                }
                order.Status = picking!.Reservations.All(r => r.Picked == r.Quantity) ? "Picked" : "Picking";
                break;
            case "ship":
            case "cancel":
                var ship = action == "ship";
                Require(ship ? order.Status == "Picked" : order.Status is "Waiting" or "Reserved" or "Picking" or "Picked",
                    "Orderns status tillåter inte åtgärden.");
                foreach (var line in picking?.Reservations ?? [])
                {
                    var balance = (await db.Balances.FindAsync(line.ProductId, line.LocationId))!;
                    balance.Reserved -= line.Quantity;
                    if (ship) await Change(line.ProductId, line.LocationId, -line.Quantity, "Shipment", order.Reference, user);
                }
                order.Status = ship ? "Shipped" : "Cancelled";
                if (ship) order.Completed = DateTime.UtcNow;
                break;
            default: throw new RuleException("Ogiltig åtgärd.");
        }
        return order;
    }, input.OperationId);

    public Task<InventoryCount> Count(int id, ActionInput input, bool approve, string user) => Atomic(async () =>
    {
        var count = await db.Counts.Include(c => c.Lines).SingleOrDefaultAsync(c => c.Id == id)
            ?? throw new RuleException("Inventeringen finns inte.");
        Require(count.Status == "Draft", "Inventeringen är stängd.");
        foreach (var row in input.Lines ?? [])
        {
            var line = count.Lines.SingleOrDefault(l => l.Id == row.LineId) ?? throw new RuleException("Inventeringsraden finns inte.");
            Require(row.Quantity >= 0, "Ange ett saldo på noll eller mer.");
            line.Counted = row.Quantity;
        }
        if (!approve) return count;
        Require(!string.IsNullOrWhiteSpace(input.Reason) && input.Reason.Length <= 500, "Ange en orsak på högst 500 tecken.");
        foreach (var line in count.Lines)
        {
            var current = (await db.Balances.FindAsync(line.ProductId, line.LocationId))?.Quantity ?? 0;
            Require(line.Counted.HasValue, "Fyll i räknat antal på alla rader.");
            Require(current == line.Expected, "Saldot har ändrats sedan inventeringen skapades. Skapa en ny inventering.");
            await Change(line.ProductId, line.LocationId, line.Counted!.Value - current, "Adjustment", $"INV-{id}", user, input.Reason!);
        }
        count.Status = "Approved";
        count.Reason = input.Reason!;
        return count;
    }, input.OperationId);
}
