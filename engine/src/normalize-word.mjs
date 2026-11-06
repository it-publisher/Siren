// Общий ключ сравнения слов: ударения, регистр, ё и знаки препинания на него не влияют.
export const normalizeWord = (text) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/́/g, "")
    .normalize("NFC")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]/gu, "");
