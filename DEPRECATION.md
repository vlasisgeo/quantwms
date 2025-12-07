Deprecation plan for `core.models.WarehouseUser`

Summary
- `core.models.WarehouseUser` is a legacy mapping model that maps users to companies/warehouses.
- The new canonical models are in the `accounts` app: `Membership` (company-scoped) and `WarehouseAssignment` (warehouse-scoped).

Plan
1. Monitoring period (2 weeks minimum)
   - Keep the mirroring signals active (`accounts.signals`) to maintain `WarehouseUser` mappings.
   - Deploy backfill command and run it in production to ensure all historical mappings are present.
   - Enable logging/metrics for usage of `WarehouseUser` accesses (search for queries referencing `core_warehouseuser` table).

2. Replace direct usages
   - Replace scripts and external tooling to call the public helpers `core.models.get_user_companies` and `core.models.get_user_warehouses`.
   - Update any tooling to read from `accounts` models directly where appropriate.

3. Deprecation
   - Add deprecation warnings in `core.models` (already present) and in internal docs.
   - Continue monitoring for another 1-2 weeks.

4. Removal
   - Once confident no external tooling requires `WarehouseUser`, remove the mirroring signals, management command for backfill can remain for audit/history, then remove the model and its migrations in a dedicated release.

Notes
- Before removal, ensure database migrations are prepared to drop the table safely and any historical data is archived if needed.
- Coordinate changes with operations (run backfill during maintenance window if necessary) and notify integrators.
