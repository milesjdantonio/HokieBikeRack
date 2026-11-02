#pragma once
// Decides whether a card is allowed, using the saved card list ("snapshot")
// from the backend. Owner: Person A
//
// The rules themselves are in lib/hbr_logic/src/access_rules.h (PC-tested).
// This file keeps the current snapshot in RAM + flash (/snapshot.json) so it
// survives reboots, and makes it safe to use from two tasks.
//
// Must work without Wi-Fi: never allow a card just because the network is down.
#include <stddef.h>
#include <stdint.h>

#include <string>

#include "access_rules.h"

// Call once from setup(), after eventQueueSetup() (which mounts LittleFS).
void accessPolicySetup();

// The decision for one card reference.
hbr::AccessResult accessPolicyCheck(const std::string &credentialRef);

// The network task offers each downloaded snapshot here.
hbr::SnapshotUpdate accessPolicyOfferSnapshot(const hbr::AuthSnapshot &incoming);

// True if a listed card would be allowed right now (have a list, clock OK, not expired).
bool accessPolicyReady();

struct AccessPolicyInfo {
  bool loaded;
  uint64_t revision;
  int64_t validUntilEpoch;
  size_t cardCount;
};
AccessPolicyInfo accessPolicyInfo();

// Throws away the saved list (serial command `forget-snapshot`). Useful after
// wiping the backend database during development.
void accessPolicyForget();
