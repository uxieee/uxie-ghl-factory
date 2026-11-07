{
  "ok": true,
  "data": {
    "hits": [
      { "id": "convai-employee-update", "method": "PUT", "path": "/ai-employees/employees/{agentId}", "coveredBy": "update_convai_agent" },
      { "id": "convai-employee-get", "method": "GET", "path": "/ai-employees/employees/{agentId}", "coveredBy": null },
      { "id": "convai-models", "method": "GET", "path": "/ai-employees/employees/models", "coveredBy": "get_ai_agent_options" },
      { "id": "convai-outbound-configs", "method": "GET", "path": "/agent-deployment/outbound-configs", "coveredBy": "get_ai_configuration_bundle" },
      { "id": "convai-outbound-triggers", "method": "GET", "path": "/agent-deployment/outbound-triggers", "coveredBy": "get_ai_configuration_bundle" },
      { "id": "convai-outbound-trigger-create", "method": "POST", "path": "/agent-deployment/outbound-triggers", "coveredBy": "set_convai_outbound" },
      { "id": "bulk-actions-request", "method": "POST", "path": "/bulk-actions/request", "coveredBy": null }
    ]
  }
}
