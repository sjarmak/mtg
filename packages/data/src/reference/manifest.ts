/**
 * The calibration corpus is a reproducible snapshot, not "whatever MTGJSON
 * serves today". Updating it is an explicit data revision: replace all source
 * hashes from one MTGJSON build, regenerate the normalized artifact, and let
 * the corpus tests show every population change.
 */

export const REFERENCE_SET_CODES = [
  'M11',
  'M13',
  'M15',
  'M20',
  'ORI',
  'ISD',
  'RTR',
  'RAV',
  'ROE',
  'SOM',
  'KTK',
  'MH2',
] as const;

export type ReferenceSetCode = (typeof REFERENCE_SET_CODES)[number];

export interface ReferenceSetSource {
  readonly code: string;
  readonly name: string;
  readonly url: string;
  readonly sha256: string;
  readonly version: string;
  readonly builtDate: string;
  readonly baseSetSize: number;
  /** Card-face records, not collector positions: double-faced cards have two. */
  readonly cardRecords: number;
  readonly tokenRecords: number;
}

const BUILD = { version: '5.3.0+20260814', builtDate: '2026-08-14' } as const;
const url = (code: string): string => `https://mtgjson.com/api/v5/${code}.json`;

export const REFERENCE_SET_SOURCES: readonly ReferenceSetSource[] = [
  {
    code: 'M11',
    name: 'Magic 2011',
    url: url('M11'),
    sha256: 'a089ef3dcc8d8c0830a07a3012c4d3343d86969721e22fe9232788091956e60f',
    ...BUILD,
    baseSetSize: 249,
    cardRecords: 249,
    tokenRecords: 6,
  },
  {
    code: 'M13',
    name: 'Magic 2013',
    url: url('M13'),
    sha256: 'aec28319d5e501bc1f0572b8460b5a419fb9b2c18c37262b8f1b14eac8f9f7f3',
    ...BUILD,
    baseSetSize: 249,
    cardRecords: 249,
    tokenRecords: 11,
  },
  {
    code: 'M15',
    name: 'Magic 2015',
    url: url('M15'),
    sha256: '9132794d3e68f3c5d08c95abef257dca84999e52d67b16244bbd659a036f3b12',
    ...BUILD,
    baseSetSize: 269,
    cardRecords: 284,
    tokenRecords: 14,
  },
  {
    code: 'M20',
    name: 'Core Set 2020',
    url: url('M20'),
    sha256: '7ae66de5ec89c214c8ffd2c3ce57a4444c6a8f1450f8a3258815f7715aef5b11',
    ...BUILD,
    baseSetSize: 280,
    cardRecords: 346,
    tokenRecords: 12,
  },
  {
    code: 'ORI',
    name: 'Magic Origins',
    url: url('ORI'),
    sha256: '60dc0f692e126c00bb2bfdf4ebfe43a9f32a1a141a73ed5373cc8653f4d0e9f8',
    ...BUILD,
    baseSetSize: 272,
    cardRecords: 293,
    tokenRecords: 15,
  },
  {
    code: 'ISD',
    name: 'Innistrad',
    url: url('ISD'),
    sha256: 'a0369b21b6270268594d780d1f5f120883481dc0ccb0bc6d07f85bd94d762d73',
    ...BUILD,
    baseSetSize: 264,
    cardRecords: 284,
    tokenRecords: 13,
  },
  {
    code: 'RTR',
    name: 'Return to Ravnica',
    url: url('RTR'),
    sha256: '659231c6af352fa5b14052a1a895734eb36be79fa6eada8d29cb3f944a56781d',
    ...BUILD,
    baseSetSize: 274,
    cardRecords: 274,
    tokenRecords: 12,
  },
  {
    code: 'RAV',
    name: 'Ravnica: City of Guilds',
    url: url('RAV'),
    sha256: 'fa4223a808e08b009bea51d99f00b8449c8eba1e54e26d8542c217b8bd175a3a',
    ...BUILD,
    baseSetSize: 306,
    cardRecords: 306,
    tokenRecords: 0,
  },
  {
    code: 'ROE',
    name: 'Rise of the Eldrazi',
    url: url('ROE'),
    sha256: '810865c45120db5c5c1f5eb6f32ad1af30195d8e3fc87035856668e2defa63e9',
    ...BUILD,
    baseSetSize: 248,
    cardRecords: 248,
    tokenRecords: 7,
  },
  {
    code: 'SOM',
    name: 'Scars of Mirrodin',
    url: url('SOM'),
    sha256: '99b2637ca5424a5ed5b6c4ffde85bcfc2624ceb7dc6a2d39e0629e722e8e090d',
    ...BUILD,
    baseSetSize: 249,
    cardRecords: 249,
    tokenRecords: 10,
  },
  {
    code: 'KTK',
    name: 'Khans of Tarkir',
    url: url('KTK'),
    sha256: '6b61faba627f9ff3235a21e28110982b20e417ca765f856f68ff0a127ee39cb0',
    ...BUILD,
    baseSetSize: 269,
    cardRecords: 293,
    tokenRecords: 13,
  },
  {
    code: 'MH2',
    name: 'Modern Horizons 2',
    url: url('MH2'),
    sha256: 'e20640a8d0a0d5b08927595dfb870961d26db87d49a05d77b04c163a6de77006',
    ...BUILD,
    baseSetSize: 303,
    cardRecords: 498,
    tokenRecords: 21,
  },
];
