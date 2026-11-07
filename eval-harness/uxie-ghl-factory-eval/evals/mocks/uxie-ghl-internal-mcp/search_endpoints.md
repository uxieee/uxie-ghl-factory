{
  "ok": true,
  "data": {
    "hits": [
      { "id": "convai-employee-update", "method": "PUT", "path": "/ai-employees/employees/{agentId}", "does": "Update a Conversation AI agent (mode, prompt, llm, opener)", "coveredBy": "update_convai_agent" },
      { "id": "convai-employee-get", "method": "GET", "path": "/ai-employees/employees/{agentId}", "does": "Read one Conversation AI agent", "coveredBy": null },
      { "id": "convai-models", "method": "GET", "path": "/ai-employees/employees/models", "does": "The Conversation AI model roster (prices, default, deprecation)", "coveredBy": "get_ai_agent_options" },
      { "id": "convai-outbound-configs", "method": "GET", "path": "/agent-deployment/outbound-configs", "does": "Read an agent's outbound configs", "coveredBy": "get_ai_configuration_bundle" },
      { "id": "convai-outbound-triggers", "method": "GET", "path": "/agent-deployment/outbound-triggers", "does": "Read an agent's outbound triggers", "coveredBy": "get_ai_configuration_bundle" },
      { "id": "convai-outbound-trigger-create", "method": "POST", "path": "/agent-deployment/outbound-triggers", "does": "Create an outbound trigger (a CRM event starts a conversation)", "coveredBy": "set_convai_outbound" },
      { "id": "bulk-actions-request", "method": "POST", "path": "/bulk-actions/request", "does": "Start a bulk action on contacts; bulkActionType bulk-conversation-ai is an AI Campaign", "coveredBy": null }
    ]
  }
}
