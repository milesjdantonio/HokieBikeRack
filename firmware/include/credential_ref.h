#pragma once
// Turns a raw card ID into a "credential reference". Owner: Person A
//
//   reference = HMAC-SHA256(HBR_CARD_KEY, "hbr-card-v1:" + card ID as lowercase hex)
//
// The Uno keeps the first 16 bytes (32 hex characters) of it; that's what is
// saved in EEPROM. The math lives in lib/hbr_logic/src/card_list.h (PC-tested).
//
// Why? The raw card ID is like a password that anyone with a $10 reader can
// see. We never store or print it. Without the key you can't turn a reference
// back into a card ID, or make a reference for a card you've never seen. (A
// copied/cloned card still has the same ID, so this does NOT stop cloning —
// see docs/SECURITY.md.)
//
// tools/device_simulator.py computes the same thing in Python.
#include "card_list.h"
#include "card_reader.h"

// True if HBR_CARD_KEY is set (>= 16 chars). Without it we deny every card.
bool credentialKeyConfigured();

// Fills `out` with the card's reference. Returns false if no key is set.
bool credentialRefFromCard(const CardId &card, uint8_t out[hbr::kCardRefLength]);
