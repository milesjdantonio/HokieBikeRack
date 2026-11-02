#pragma once
// Saves events to flash (LittleFS) until they are sent to the backend. Owner: Person B
// Events survive reboots and power loss. Each event gets an ID once, so
// sending it again after a failed upload does not create duplicates.
#include <Arduino.h>
#include <ArduinoJson.h>
#include <vector>

// Call once from setup(). Returns false if storage is unavailable
// (then nothing can be queued).
bool eventQueueSetup();

// Save one event. severity must be INFO, LOW, MEDIUM, HIGH or CRITICAL.
// occurredAt is the time it happened. detailsJson is extra info as a JSON object.
// Returns false if it could not be saved.
bool eventQueuePush(const char *type, const char *severity, const char *occurredAt,
                    const char *detailsJson = "{}");

// Copies up to `limit` of the oldest saved events into `batch`, and their IDs
// into `ids`. Leaves them saved. Returns false if storage isn't ready.
bool eventQueueReadBatch(JsonArray batch, std::vector<String> &ids, size_t limit);

// Deletes the events with these IDs (call after the backend accepted them).
bool eventQueueRemove(const std::vector<String> &ids);
