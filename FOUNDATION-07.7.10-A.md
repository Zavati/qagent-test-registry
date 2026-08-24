# Foundation 07.7.10-A — Test Registry Suite Definition

Introduces immutable Suite roots/versions and the zero-config Project Test Inventory.

- Existing Test Design versioning remains unchanged.
- `0001_test_registry_foundation.sql` remains immutable.
- `0002_foundation_07_7_10_a_suite_definition.sql` adds `test_suites` and `test_suite_versions`.
- Project Inventory reads only latest active Test Design versions and selects only scenarios with `automation.readiness=READY`.
- Auto Suite has stable project identity and immutable `suitev_*` snapshots.
- Unchanged inventory does not create duplicate Suite versions.
- Selection persists references only; no runtime data or secrets.
