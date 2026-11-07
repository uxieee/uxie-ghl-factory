---
expect:
  locationId: ["loc_1"]
---
{
  "ok": true,
  "data": {
    "locationId": "loc_1",
    "complete": true,
    "components": {
      "conversationAi": {
        "complete": true,
        "items": [
          {
            "id": "agent_1",
            "row": { "id": "agent_1", "name": "Front Desk Bot", "botType": "PROMPT_BASED_BOT", "mode": "off" },
            "tombstone": false,
            "detailRead": true,
            "detail": {
              "id": "agent_1",
              "locationId": "loc_1",
              "name": "Front Desk Bot",
              "botType": "PROMPT_BASED_BOT",
              "mode": "off",
              "channels": ["SMS"],
              "llm": { "primary": "gpt-4.1", "secondary": "gpt-4.1-mini" },
              "fullPrompt": "## Personality\nFriendly front-desk assistant.\n## Goal\nAnswer questions and book appointments.\n## Instructions\nKeep replies short.",
              "outboundOpeningMessage": { "mode": "static", "body": "Hi {{contact.first_name}}, thanks for reaching out. How can we help?" },
              "outboundDisclaimer": { "enabled": true, "style": "concise" }
            },
            "routingRead": true,
            "routing": [{ "channel": "SMS", "enabled": true, "allIdentifiers": true }],
            "outboundRead": true,
            "outbound": {
              "configs": [
                {
                  "id": "outbound_config_1",
                  "locationId": "loc_1",
                  "agentId": "agent_1",
                  "channel": "SMS",
                  "sendingNumber": "sending_number_1",
                  "enabled": true,
                  "complianceSettingsAccepted": true,
                  "complianceConfigurationsAccepted": true,
                  "acceptedBy": "user_1",
                  "acceptedAt": "2026-10-29T16:43:46.477Z"
                }
              ],
              "triggers": [
                {
                  "id": "outbound_trigger_1",
                  "locationId": "loc_1",
                  "agentId": "agent_1",
                  "type": "contact_tag",
                  "config": { "tagFilter": { "action": "added", "tagNames": ["new-lead"] } },
                  "deleted": false,
                  "createdBy": "user_1",
                  "createdAt": "2026-10-29T16:16:54.548Z",
                  "enabled": true,
                  "updatedAt": "2026-10-29T16:45:24.741Z"
                }
              ]
            },
            "outboundArmed": false
          },
          {
            "id": "agent_2",
            "row": { "id": "agent_2", "name": "Booking Flow", "botType": "FLOW_BUILDER_BOT_V2", "mode": "auto-pilot" },
            "tombstone": false,
            "detailRead": true,
            "detail": {
              "id": "agent_2",
              "locationId": "loc_1",
              "name": "Booking Flow",
              "botType": "FLOW_BUILDER_BOT_V2",
              "mode": "auto-pilot",
              "channels": ["SMS", "Live_Chat"],
              "cancelEnabled": false,
              "rescheduleEnabled": true
            },
            "routingRead": true,
            "routing": [{ "channel": "SMS", "enabled": true, "allIdentifiers": true }],
            "outboundRead": true,
            "outbound": { "configs": [], "triggers": [] },
            "outboundArmed": false
          },
          {
            "id": "agent_3",
            "row": { "id": "agent_3", "name": "Sales Assistant", "botType": "PROMPT_BASED_BOT", "mode": "auto-pilot" },
            "tombstone": false,
            "detailRead": true,
            "detail": {
              "id": "agent_3",
              "locationId": "loc_1",
              "name": "Sales Assistant",
              "botType": "PROMPT_BASED_BOT",
              "mode": "auto-pilot",
              "channels": ["SMS"],
              "llm": { "primary": "gpt-4.1", "secondary": "gpt-4.1-mini" },
              "fullPrompt": "## Personality\nWarm and direct.\n## Goal\nQualify leads and book a call.\n## Instructions\nAsk one question at a time.",
              "outboundOpeningMessage": { "mode": "ai_generated", "body": "Greet the contact by first name and ask how we can help." },
              "outboundDisclaimer": { "enabled": true, "style": "concise" }
            },
            "routingRead": true,
            "routing": [{ "channel": "SMS", "enabled": true, "allIdentifiers": true }],
            "outboundRead": true,
            "outbound": {
              "configs": [
                {
                  "id": "outbound_config_3",
                  "locationId": "loc_1",
                  "agentId": "agent_3",
                  "channel": "SMS",
                  "sendingNumber": "sending_number_1",
                  "enabled": true,
                  "complianceSettingsAccepted": true,
                  "complianceConfigurationsAccepted": true,
                  "acceptedBy": "user_1",
                  "acceptedAt": "2026-10-29T16:43:46.477Z"
                }
              ],
              "triggers": []
            },
            "outboundArmed": false
          },
          {
            "id": "agent_4",
            "row": { "id": "agent_4", "name": "Support Bot", "botType": "PROMPT_BASED_BOT", "mode": "auto-pilot" },
            "tombstone": false,
            "detailRead": true,
            "detail": {
              "id": "agent_4",
              "locationId": "loc_1",
              "name": "Support Bot",
              "botType": "PROMPT_BASED_BOT",
              "mode": "auto-pilot",
              "channels": ["SMS", "Live_Chat"],
              "llm": { "primary": "gpt-5", "secondary": "gpt-5-mini" },
              "fullPrompt": "## Personality\nPatient support agent.\n## Goal\nResolve support questions.\n## Instructions\nHand over to a human when unsure."
            },
            "routingRead": true,
            "routing": [{ "channel": "Live_Chat", "enabled": true, "allIdentifiers": true }],
            "outboundRead": true,
            "outbound": { "configs": [], "triggers": [] },
            "outboundArmed": false
          }
        ],
        "outboundEnabled": ["agent_1", "agent_3"],
        "outboundArmed": [],
        "outboundUnread": [],
        "routingPinned": []
      },
      "voiceAi": { "complete": true, "items": [] },
      "agentStudio": { "complete": true, "items": [] }
    },
    "warnings": []
  }
}
