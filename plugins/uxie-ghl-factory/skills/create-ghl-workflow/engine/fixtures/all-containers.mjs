// W6 item 2: one IR that exercises every container kind the compiler emits, plus a forward goto and two
// per-type stepIndex steps. Shared by the pin and lifter tests; synthetic, no account data.
export const act = (ref, tag) => ({ ref, kind: 'action', type: 'add_contact_tag', name: ref, attributes: { tags: [tag ?? ref] } });
export const code = (ref) => ({ ref, kind: 'action', type: 'custom_code', name: ref, attributes: { code: 'return {}', language: 'javascript', output: { ok: true } } });

// A branching step must end its list, so each container holds the next one in its first lane.
const nest = (...makers) => makers.reduceRight((rest, make) => make(rest), []);
export const ALL = {
  name: 'All containers',
  triggers: [{ ref: 'tr', type: 'contact_tag', name: 'Tag', filters: [{ field: 'tagsAdded', operator: 'index-of-true', value: 'go' }] }],
  graph: [act('start'), code('code1'), ...nest(
    (rest) => [{ ref: 'ie', kind: 'if_else', name: 'Segment', branches: [
      { ref: 'hot', name: 'Hot', conditions: [{ conditionType: 'contact_detail', tag: 'hot' }, { conditionType: 'contact_detail', tag: 'vip' }], then: [act('h1'), ...rest] },
      { ref: 'warm', name: 'Warm', conditions: [{ conditionType: 'contact_detail', tag: 'warm' }], then: [] },
    ] }],
    (rest) => [{ ref: 'ie2', kind: 'if_else', name: 'With else', branches: [
      { ref: 'yes', name: 'Yes', conditions: [{ conditionType: 'contact_detail', tag: 'y' }], then: [act('y1'), ...rest] },
      { ref: 'els', name: 'Otherwise', else: true, then: [act('e1')] },
    ] }],
    (rest) => [{ ref: 'ba', type: 'conversationai_book_appointment', name: 'Book', attributes: { calendarId: 'CAL' }, onBooked: [act('b1'), ...rest], onNotBooked: [] }],
    (rest) => [{ ref: 'sb', type: 'conversationai_services_booking', name: 'Svc', attributes: { conversationai_services: ['svc1'], conversationai_booking_description: 'book' }, onBooked: rest }],
    (rest) => [{ ref: 'spl', type: 'conversationai_ai_splitter', name: 'Splitter', attributes: { description: 'route' }, branches: [{ name: 'Sales', then: [act('s1'), ...rest] }, { name: 'Support', then: [] }] }],
    (rest) => [{ ref: 'mw', kind: 'wait', waitType: 'reply', name: 'Reply wait', reply: { steps: ['start'], labels: ['SMS'] }, timeout: { unit: 'days', value: 1 },
      onEvent: [act('r1'), ...rest], onTimeout: [act('r2')] }],
    (rest) => [{ ref: 'fo', type: 'find_opportunity', name: 'Find opp', find: { filters: [{ field: 'pipeline_id', operator: 'eq', value: 'P1' }] }, onFound: [act('f1'), ...rest] }],
    (rest) => [{ ref: 'fc', type: 'find_contact', name: 'Find dup', find: { fields: [{ field: 'email', value: '{{contact.email}}', title: 'Email', type: 'string', date: '' }] }, onFound: rest, onNotFound: [] }],
    (rest) => [{ ref: 'mc', type: 'lc_merge_contact', name: 'Merge', onFound: rest }],
    (rest) => [{ ref: 'sp', kind: 'split', name: 'A/B', mode: 'weighted', paths: [
      { ref: 'pa', name: 'A', weight: 60, then: [code('code2'), ...rest] },
      { ref: 'pb', name: 'B', weight: 40, then: [] },
    ] }],
    (rest) => [{ ref: 'int', kind: 'ai_intent', name: 'Intent', inputText: 'x', branches: [{ name: 'Positive', then: [act('p1'), ...rest] }] }],
    (rest) => [{ ref: 'aid', kind: 'ai_decision', name: 'Decide', instructions: 'i', information: 'n', branches: [
      { ref: 'cel', name: 'Celebrate', description: 'm', then: [act('c1'), ...rest] },
      { ref: 'skip', name: 'Skip', description: 'n', then: [] },   // a lifted spec names every lane by its stored id
    ] }],
    () => [{ ref: 'back', kind: 'goto', name: 'Over', target: 'e1' }],
  )],
};

