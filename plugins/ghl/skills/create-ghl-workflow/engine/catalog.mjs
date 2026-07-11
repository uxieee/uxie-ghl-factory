// Plan-1 minimal seed. Plan 2 replaces the internals (wiring the repo's
// catalog/ + reference/ assets) behind this exact interface.
const STEPS = {
  add_contact_tag: { type: 'add_contact_tag', situational: [], isMultipathContainer: false },
  wait: { type: 'wait', situational: [], isMultipathContainer: false },
  email: { type: 'email', situational: [], isMultipathContainer: false, requiresTemplateWhenReferenced: true },
  sms: { type: 'sms', situational: [], isMultipathContainer: false },
  custom_webhook: { type: 'custom_webhook', situational: [], isMultipathContainer: false, premium: true },
  custom_code: { type: 'custom_code', situational: [], isMultipathContainer: false, premium: true },
  add_to_workflow: { type: 'add_to_workflow', situational: [], isMultipathContainer: false, referencesWorkflow: true },
  remove_from_workflow: { type: 'remove_from_workflow', situational: [], isMultipathContainer: false, referencesWorkflow: true },
  internal_create_opportunity: { type: 'internal_create_opportunity', situational: ['workflowsActionType'], isMultipathContainer: false, requiresPipeline: true },
  internal_update_opportunity: { type: 'internal_update_opportunity', situational: ['workflowsActionType'], isMultipathContainer: false },
  find_opportunity: { type: 'find_opportunity', situational: [], isMultipathContainer: true },
  if_else: { type: 'if_else', situational: ['parent', 'sibling', 'cat', 'comments', 'nodeType'], isMultipathContainer: true },
};
const TRIGGERS = {
  contact_tag: { type: 'contact_tag', masterType: 'highlevel' },
};

export function loadCatalog() {
  return {
    step: (type) => STEPS[type],
    trigger: (type) => TRIGGERS[type],
  };
}
