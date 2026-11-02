#pragma once
// Turns a raw card ID into a "credential reference". Owner: Person A
//
//   reference = HMAC-SHA256(HBR_CARD_KEY, "hbr-card-v1:" + card ID as lowercase hex)
//   -> 64 hex characters
//
// Why? The raw card ID is like a password that anyone with a $10 reader can
// see. We never send or store it. The backend only ever sees the reference.
// Without the key you can't turn a reference back into a card ID, or make a
// reference for a card you've never seen. (A copied/cloned card still has
// the same ID, so this does NOT stop cloning — see docs/SECURITY.md.)
//
// tools/device_simulator.py computes the same thing in Python.
#include <string>

#include "card_reader.h"

// True if HBR_CARD_KEY is set (>= 16 chars). Without it we deny every card.
bool credentialKeyConfigured();

// Fills `outHex` with the 64-char reference. Returns false if no key is set.
bool credentialRefFromCard(const CardId &card, std::string &outHex);
