#pragma once
// PN532 NFC card reader. Owner: Person A
// Reads cards only. Deciding whether a card is allowed is NOT done here;
// that belongs in access_policy.
#include <stdint.h>

// Most NFC cards have a 4- or 7-byte ID. 10 leaves room for longer ones.
constexpr uint8_t CARD_ID_MAX_LENGTH = 10;

// A card's ID: up to 10 bytes, plus how many of them are actually used.
struct CardId {
  uint8_t bytes[CARD_ID_MAX_LENGTH];
  uint8_t length;
};

// Call once from setup().
void cardReaderSetup();

// Call from loop(). Returns true if a card was read, and fills in `card`.
// Returns false if no card is present.
bool cardReaderReadCard(CardId& card);
