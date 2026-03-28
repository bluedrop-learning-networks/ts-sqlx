---
id: ts-hjqt
status: closed
deps: [ts-t8ix, ts-ux5n, ts-28xs, ts-dtrs, ts-2j5z, ts-85dn, ts-luyx]
links: []
created: 2026-03-28T14:48:31Z
type: task
priority: 0
assignee: Donal Mac An Ri
parent: ts-7bbj
tags: [testing, integration]
---
# Task 24: Final Integration

Final Integration - Run full test suite and verify all packages build without errors.

### Task 24: Final Integration — Run All Tests

- [ ] **Step 1: Run the full test suite**

Run: `pnpm vitest run`
Expected: All tests pass.

- [ ] **Step 2: Verify build**

Run: `pnpm -r build`
Expected: All packages build without errors.

- [ ] **Step 3: Final commit (if any remaining changes)**

```bash
git add packages/ tests/
git commit -m "chore: final integration wiring and cleanup"
```

## Design

Full test suite run and build verification.

## Acceptance Criteria

pnpm vitest run passes all tests; pnpm -r build succeeds with no errors; final commit created

