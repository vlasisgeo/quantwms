"""Signals for `accounts` app.

Legacy mirroring of accounts -> `core.WarehouseUser` has been removed.
This module intentionally does not write to `core.WarehouseUser` to avoid
referencing the legacy model. If you need to re-enable mirroring for a
migration window, set `ACCOUNTS_MIRROR_LEGACY = True` in settings and add
the mirroring handlers back in a controlled change.
"""

# No-op signals kept for future extension.
