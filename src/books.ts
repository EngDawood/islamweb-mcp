/**
 * Dictionaries under islamweb's library subject 73 ("معاجم اللغة"):
 * https://www.islamweb.net/ar/library/index.php?page=bookslist&subject=73
 *
 * id ranges (idfrom/idto) come straight from that listing page, not guessed.
 */
export interface DictionaryBook {
  bookId: number;
  key: string;
  title: string;
  author: string;
  startId: number;
  endId: number;
}

export const DICTIONARIES: DictionaryBook[] = [
  {
    bookId: 122,
    key: "lisan-al-arab",
    title: "لسان العرب",
    author: "ابن منظور - أبو الفضل جمال الدين محمد بن مكرم الأنصاري",
    startId: 1,
    endId: 9305,
  },
  {
    bookId: 123,
    key: "al-qamus-al-muhit",
    title: "القاموس المحيط",
    author: "الفيروزآبادي",
    startId: 1,
    endId: 8553,
  },
  {
    bookId: 121,
    key: "al-nihaya-fi-gharib-al-hadith",
    title: "النهاية في غريب الحديث والأثر",
    author: "ابن الأثير",
    startId: 1,
    endId: 4338,
  },
  {
    bookId: 124,
    key: "maqayis-al-lugha",
    title: "معجم مقاييس اللغة",
    author: "ابن فارس",
    startId: 1,
    endId: 5102,
  },
  {
    bookId: 125,
    key: "mukhtar-al-sihah",
    title: "مختار الصحاح",
    author: "الرازي",
    startId: 1,
    endId: 3509,
  },
];

export function findDictionary(key: string): DictionaryBook | undefined {
  return DICTIONARIES.find((d) => d.key === key || String(d.bookId) === key);
}
