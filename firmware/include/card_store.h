#pragma once
// The allowed-card list, kept in the Uno's EEPROM so it survives power cuts.
// Owner: Person A
//
// Replaces the ESP32's downloaded "snapshot": with no Wi-Fi, cards are added
// at the rack with the `enroll` serial command (or `add <reference>`). The
// list logic itself is in lib/hbr_logic/src/card_list.h (PC-tested).
//
// There is no clock on the Uno, so the list never expires. To take a card
// away, remove it with `remove <n>` (see `list`).
#include "card_list.h"

// Call once from setup().
void cardStoreSetup();

// The list itself (add/remove/find).
hbr::CardList &cardStore();
