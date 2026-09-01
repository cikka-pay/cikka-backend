const d = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 6, 7, 8, 9, 0, 1, 2, 3, 4],
  [6, 7, 8, 9, 5, 1, 2, 3, 4, 0],
  [7, 8, 9, 5, 6, 2, 3, 4, 0, 1],
  [8, 9, 5, 6, 7, 3, 4, 0, 1, 2],
  [9, 5, 6, 7, 8, 4, 0, 1, 2, 3]
];

const p = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 4, 9, 0],
  [2, 6, 8, 9, 7, 0, 4, 5, 1, 3],
  [3, 7, 9, 0, 8, 1, 5, 6, 2, 4],
  [4, 8, 0, 1, 9, 2, 6, 7, 3, 5],
  [5, 9, 1, 2, 0, 3, 7, 8, 4, 6],
  [6, 0, 2, 3, 1, 4, 8, 9, 5, 7],
  [7, 1, 3, 4, 2, 5, 9, 0, 6, 8]
];

const inv = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

function generateVerhoeffChecksum(first11Digits: string) {
  let c = 0;
  const myArray = first11Digits.split('').reverse().map(Number);
  for (let i = 0; i < myArray.length; i++) {
    c = d[c][p[(i + 1) % 8][myArray[i]]];
  }
  return inv[c];
}

function validateVerhoeff(num: string) {
  let c = 0;
  const myArray = num.split('').reverse().map(Number);
  for (let i = 0; i < myArray.length; i++) {
    c = d[c][p[i % 8][myArray[i]]];
  }
  return c === 0;
}

const prefix = "43938217984"; // First 11 digits of Sujal's number
const checkDigit = generateVerhoeffChecksum(prefix);
const validNumber = prefix + checkDigit;

console.log(`Input First 11 Digits: ${prefix}`);
console.log(`Correct Verhoeff 12th Digit: ${checkDigit}`);
console.log(`Valid Checksum Aadhaar: ${validNumber}`);
console.log(`Validation Check: ${validateVerhoeff(validNumber)}`);
