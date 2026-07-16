// Tag dependency resolution (offline extraction half).
// Tags in GHL workflows are referenced by NAME, never id. The builder rejects
// unknown tag names ("Referenced Tag does not exist"), so the orchestrator must
// ensure every referenced name exists in the location before building.
// This module is the pure/offline half: collect the names an IR needs. The
// actual list/create API calls live in the orchestrator (they need network).

// Collect every tag name an IR references: add/remove_contact_tag steps,
// contact_tag triggers, and if_else tag conditions. Returned de-duplicated,
// case-insensitively (first-seen casing preserved).
export function collectRequiredTags(ir) {
  const byLower = new Map(); // lowerName -> original casing (first seen)
  const add = (name) => {
    if (typeof name !== 'string' || !name) return;
    const k = name.toLowerCase();
    if (!byLower.has(k)) byLower.set(k, name);
  };

  for (const trig of ir.triggers ?? []) {
    if (trig.type === 'contact_tag') {
      for (const f of trig.filters ?? []) {
        if (f.field === 'tagsAdded' || f.field === 'tagsRemoved') {
          for (const v of [].concat(f.value ?? [])) add(v);
        }
      }
    }
  }

  const walk = (nodes) => {
    for (const n of nodes ?? []) {
      if (n.type === 'add_contact_tag' || n.type === 'remove_contact_tag') {
        for (const t of n.attributes?.tags ?? []) add(t);
      }
      for (const b of n.branches ?? []) {
        for (const c of b.conditions ?? []) {
          // if_else tag conditions — cover BOTH the simple `tag:` intent key and the
          // full/legacy shape (conditionSubType 'tags' plural or 'tag', value string OR
          // array). The compiler's normalizer accepts all of these, so tag-name collection
          // (for pre-creation) must too, or the builder rejects "Referenced Tag does not exist".
          if (c.conditionType !== 'contact_detail') continue;
          if (c.tag != null) for (const t of [].concat(c.tag)) add(t);
          if (c.conditionSubType === 'tags' || c.conditionSubType === 'tag') {
            for (const t of [].concat(c.conditionValue ?? [])) add(t);
          }
        }
        walk(b.then);
      }
      for (const p of n.paths ?? []) walk(p.then);
      walk(n.onEvent);      // multipath wait — primary path
      walk(n.onTimeout);    // multipath wait — timeout path
      walk(n.onFound);      // find_opportunity — found path
      walk(n.onNotFound);   // find_opportunity — not-found path
    }
  };
  walk(ir.graph);

  return [...byLower.values()];
}

// Same job, EDIT path: collect every tag name a list of edit ops references.
// The edit path had no tag pre-creation at all — orchestrate() does it for builds, so an
// edit that added a tag-referencing trigger/step pointed at a tag that didn't exist
// ("Referenced Tag does not exist" — the exact bug class orchestrate was written to kill).
//
// Rather than duplicate the traversal, project the ops into a synthetic IR and reuse
// collectRequiredTags — one source of truth for what counts as a tag reference.
export function collectOpTags(ops) {
  const triggers = [], graph = [];
  for (const op of ops ?? []) {
    // addTrigger/modifyTrigger. modifyTrigger may omit `type` (it's inherited from the
    // live trigger), so default it — the tagsAdded/tagsRemoved FIELD gate below does the
    // real filtering, and a non-tag trigger has no such filter rows to match.
    if (op.trigger) triggers.push({ ...op.trigger, type: op.trigger.type ?? 'contact_tag' });
    // appendStep / insertAfter / appendToBranch carry a full step node.
    if (op.step) graph.push(op.step);
    // modifyStep patches attributes directly; a `tags` key means the patched step
    // references those tags, whatever its type.
    if (op.op === 'modifyStep' && op.attrPatch?.tags)
      graph.push({ type: 'add_contact_tag', attributes: { tags: [].concat(op.attrPatch.tags) } });
    // addBranch conditions can carry tag intent (if_else tag conditions).
    if (op.op === 'addBranch' && op.conditions?.length)
      graph.push({ branches: [{ conditions: op.conditions, then: [] }] });
  }
  return collectRequiredTags({ triggers, graph });
}

// Given the required names and the location's existing tag names, return the
// names that must be created. `existingNames` is any iterable of strings.
export function missingTags(requiredNames, existingNames) {
  const have = new Set([...existingNames].map((n) => String(n).toLowerCase()));
  return requiredNames.filter((n) => !have.has(n.toLowerCase()));
}
