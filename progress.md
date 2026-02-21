Original prompt: add another corner hint/constraint type: surrounding path count. it shows a number from 0 to 3 in which shows the number of connections between 4 cells around that corner made by the path.

- Added parser/state plumbing plan: `cornerCounts: [[vr, vc, count], ...]`.
- Implemented validation + snapshot carry for corner count constraints.
- Implemented hint evaluation logic for corner counts with live good/pending/bad behavior.
- Implemented canvas rendering hook for numeric corner badges.
- Added legend entry and one tutorial level that uses `cornerCounts`.
- Ran parser/rules checks via Node (validation + corner-count status transitions + level parse load).
- Updated blocked-cell detection to region reachability from path endpoints:
  - now marks full unreachable unvisited regions enclosed by walls or non-endpoint path.
  - preserves stitch diagonal traversal as valid connectivity.
- Verified with targeted Node scenarios: enclosed 2-cell pocket is flagged, endpoint-open pocket is not, stitch-diagonal reachable cell is not flagged.
