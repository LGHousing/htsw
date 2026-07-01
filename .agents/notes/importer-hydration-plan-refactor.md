# Importer Hydration Plan Refactor Note

The importer boundary we want to keep:

- shallow read observes Housing rows and child-list summaries;
- Knowledge trust carries both the path/hash proof and cached child-list data;
- hydration completes observed rows either by reading Housing or by copying trusted cached data;
- diff receives completed observed actions plus desired actions, and should not know whether a child list came from Housing or Knowledge.

Do not reintroduce `trusted*` flags on observed action rows just so diff can skip work. If trust is accepted, complete the observed action before diff.
