#include "card_reader.h"

void cardReaderSetup() {
  // TODO: start the PN532 once the bus (I2C/SPI), pins, and library are confirmed.
  // Do not log raw card IDs in committed logs or screenshots.
}

bool cardReaderReadCard(CardId& card) {
  // TODO: ask the PN532 for a card and copy its ID into `card`.
  card.length = 0;
  return false;  // placeholder: "no card present"
}
