# Phase 5 解析與提交演算法（實作前規格）

狀態：依已核准 PHASE5_PLAN 實作；本文件不是驗收結果。

## 純解析

```
validate format, compressed byte limit, text encoding
if XLSX: validate ZIP entries / total actual decompressed bytes / macros / external links
read immutable table rows (never evaluate cells)
map source headers to allowlisted canonical headers; reject duplicate mappings
for each task row:
  parse identifiers, duration/work integer minutes, ISO/explicit-locale dates
  validate milestone, actual/progress, constraints, planned/baseline date pairs
  rebuild hierarchy via outline stack; assign stable external identity
  tokenize predecessor entire field using explicit ID/UID mode
  emit row/field/code errors; never silently skip invalid row
validate all identifiers and dependency endpoints, self/cycle, bounds
return immutable normalized tasks + dependencies + raw ancillary sheets + issues
```

Dates use IANA timezone. Offset-less DST gaps/folds reject. Excel workbook date1904 honored; unsupported cells/precision report errors. Summary dates are derived, not independently scheduled. Decimal durations require an exact integer-minute result.

## Preview / commit

```
scope -> scan-clean file -> parse -> resolve resources/calendars/anchor
capture version vector + file/parser/mapping/decisions hashes
validate merged existing + proposed graph using scheduler; keep actual facts
save immutable preview with errors / warnings / decisions / differences
commit: lock project and affected rows -> compare vector -> validate again
single transaction: tasks -> hierarchy -> dependencies -> assignments -> snapshots
                    -> external identity -> audits -> outbox -> success
failure: rollback all business mutations, record failure outside rollback
same idempotency key + same request hash => replay; different hash => conflict
```

Export uses one consistent DB snapshot; task-order traversal keeps parent before child. Work counts leaf assignment work once. CSV text protection is reversible via a manifest, while XLSX uses string cells. Round-trip compares external identities, fields, graph, assignments and snapshots, not database UUIDs.

Tests before implementation: quoted CSV newline/BOM/duplicate header; locale ambiguous date/DST gap/fold; 1900/1904 XLSX; positive/negative FS/SS/FF/SF lag; unknown ID vs UID; hierarchy jumps/cycles; 100% without actual finish; 601-minute allocation; byte/row/ZIP limits; formula/macro/external link refusal; preview stale, rollback and concurrent idempotency.
