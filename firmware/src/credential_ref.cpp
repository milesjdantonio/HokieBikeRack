#include "credential_ref.h"

#include <string.h>

#include "device_config.h"

bool credentialKeyConfigured() { return strlen(HBR_CARD_KEY) >= 16; }

bool credentialRefFromCard(const CardId &card, uint8_t out[hbr::kCardRefLength]) {
  if (!credentialKeyConfigured()) return false;
  return hbr::makeCardRef(HBR_CARD_KEY, strlen(HBR_CARD_KEY), card.bytes, card.length, out);
}
