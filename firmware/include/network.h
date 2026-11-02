#pragma once
// Wi-Fi and sending queued events to the backend. Owner: Person B
// The lock must keep working safely when the network is down.

// Call once from setup().
void networkSetup();

// Call every loop(): reconnects Wi-Fi if needed, and every 15 seconds
// uploads queued events.
void networkUpdate();

bool networkIsConnected();
