#pragma once
// PN532 NFC card reader, over I2C (default) or UART (HBR_READER_UART 1). Owner: Person A
// Reads cards only. Deciding whether a card is allowed is NOT done here;
// that belongs in access_policy.
//
// Non-blocking: cardReaderPoll() returns immediately. We ask the PN532 to
// "wait for a card", then check a 1-byte "ready?" flag over I2C every 50 ms.
// See docs/notes/firmware.md ("Reading cards without freezing the loop").
#include <stdint.h>

#include "hbr_util.h"

// Most NFC cards have a 4- or 7-byte ID. 10 leaves room for longer ones.
constexpr uint8_t CARD_ID_MAX_LENGTH = hbr::kMaxCardIdLength;

// A card's ID: up to 10 bytes, plus how many of them are actually used.
// Treat this as SENSITIVE: never print it or save it. Turn it into a
// credential reference first (credential_ref.h).
struct CardId {
  uint8_t bytes[CARD_ID_MAX_LENGTH];
  uint8_t length;
};

// Call once from setup(), after Wire.begin(). Returns false if no PN532 answered.
bool cardReaderSetup();

// Call every loop(). Returns true (and fills `card`) when a card was just read.
bool cardReaderPoll(CardId &card);

// False if the reader stopped answering. It retries by itself every 15 s.
bool cardReaderHealthy();
