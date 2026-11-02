#pragma once
// Wi-Fi + talking to the backend. Owner: Person B
// The lock must keep working safely when the network is down.
//
// All network work runs in its OWN FreeRTOS task on core 0, so a slow server
// can never freeze card reads, tamper checks or the re-lock timer in loop()
// (that was bug #1 in KNOWNBUGS.txt). The task:
//   - keeps Wi-Fi connected and sets the clock from the internet (NTP)
//   - downloads the card list (authorization snapshot) every 60 s
//   - sends a heartbeat every 60 s
//   - uploads queued events right away when asked, with back-off on failure

// Call once from setup(), after the event queue and access policy are set up.
void backendSyncSetup();

// "There's a new event, send it soon." Safe to call from loop().
void backendSyncRequestUpload();

// Ask for a fresh card list now (serial command `sync`).
void backendSyncRequestSnapshot();

bool backendSyncWifiConnected();

// True when Wi-Fi + device ID/token + URL are filled in config.h.
bool backendSyncConfigured();
