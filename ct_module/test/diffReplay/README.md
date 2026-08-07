# Diff replay

Captured records preserve whether the live diff used `itemDiff`, but replay always calls
`diffActionList` without it because the callbacks are not serializable. Results for records
where `hadItemDiff` is true are therefore an approximation.

To score a real capture from PowerShell:

```powershell
$env:HTSW_DIFF_CAPTURE='C:\path\to\import-diff-capture.jsonl'
npm test -- test/diffReplay/diffReplay.test.ts
```
