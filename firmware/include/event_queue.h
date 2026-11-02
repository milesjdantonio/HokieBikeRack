#pragma once
// Saves events to flash (LittleFS) until they are sent to the backend. Owner: Person B
// Events survive reboots and power loss. Each event gets an ID (a UUID) once,
// so sending it again after a failed upload does not create duplicates.
//
// Thread-safe: the main loop pushes events while the network task reads and
// removes them, so every function takes a mutex (a "one at a time" lock).
#include <Arduino.h>
#include <ArduinoJson.h>

#include <vector>

// Call once from setup(). Returns false if storage is unavailable
// (then nothing can be queued).
bool eventQueueSetup();

// Save one event. severity must be INFO, LOW, MEDIUM, HIGH or CRITICAL.
// The time is filled in automatically (null if the clock isn't set yet; the
// event also carries uptimeMs so it can still be ordered).
// details: extra info as a JSON object (pass an empty JsonDocument for none).
// Returns false if it could not be saved (e.g. queue full).
bool eventQueuePush(const char *type, const char *severity, const JsonDocument &details);
bool eventQueuePush(const char *type, const char *severity);

// Copies up to `limit` of the oldest saved events into `batch`, and their IDs
// into `ids`. Leaves them saved. Returns false if storage isn't ready.
bool eventQueueReadBatch(JsonArray batch, std::vector<String> &ids, size_t limit);

// Deletes the events with these IDs (call after the backend accepted them).
bool eventQueueRemove(const std::vector<String> &ids);

// How many events are waiting.
size_t eventQueueCount();

// Deletes everything (serial command `clear-queue`).
bool eventQueueClear();
