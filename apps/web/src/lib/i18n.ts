// Capture-page strings, English and Russian. One flat dictionary, so a missing
// translation is a type error, not a blank on someone's phone.

import type { Language } from "@move-survey/contracts";

const en = {
  title: "Video survey",
  intro: "Walk through the home with your phone camera, room by room, closets open. About 10 minutes. We'll turn the video into an inventory for the move estimate.",
  introRooms: "Record each room with your phone camera, closets open. About 10 minutes. We'll turn the videos into an inventory for the move estimate.",
  packingSelf: "We're packing boxes ourselves",
  consent: "You may use these videos to improve estimates",
  privacy: "Videos are used only for this estimate and deleted after the retention period.",
  start: "Start",
  continueRecording: "Continue recording",
  inAppBrowser: "For the best results, open this link in Safari or Chrome (tap ⋯ → Open in browser).",
  tips: ["Hold the phone the same way the whole time", "Walk slowly and pan around each room", "Open closets, cabinets and the garage", "Say out loud anything that isn't moving"],
  record: "Start recording",
  nextRoom: "Next room",
  done: "Done",
  whichRoom: "Which room?",
  tooDark: "It's dark — turn on a light",
  tooFast: "Slow down a little",
  paused: "Recording paused. What you filmed is saved.",
  cameraError: "We couldn't open the camera. Allow camera access in your browser settings, or upload videos instead.",
  uploadInstead: "Upload videos or photos instead",
  uploading: (n: number) => `Uploading… ${n} part${n === 1 ? "" : "s"} left. Keep this page open.`,
  allUploaded: "Everything is uploaded.",
  doneTitle: "Thank you!",
  doneBody: "Your inventory is being prepared. Nothing else to do.",
  expired: "This link has expired or doesn't exist. Please ask your moving company for a new one.",
  closed: "This survey is complete. Thank you!",
  error: "Something went wrong. Please try again.",
  part: (n: number) => `Part ${n}`,
  rooms: {
    living_room: "Living room", family_room: "Family room", dining_room: "Dining room", kitchen: "Kitchen",
    bedroom: "Bedroom", kids_room: "Kids' room", nursery: "Nursery", office: "Office", bathroom: "Bathroom",
    laundry: "Laundry", hallway: "Hallway & closets", garage: "Garage", basement: "Basement", attic: "Attic",
    patio: "Patio / yard", storage: "Storage unit", other: "Other",
  },
};

type Dict = typeof en;

const ru: Dict = {
  title: "Видеоосмотр",
  intro: "Пройдите по дому с камерой телефона, комната за комнатой, с открытыми шкафами. Около 10 минут. По видео мы составим опись вещей для расчёта переезда.",
  introRooms: "Снимите каждую комнату камерой телефона, с открытыми шкафами. Около 10 минут. По видео мы составим опись вещей для расчёта переезда.",
  packingSelf: "Коробки пакуем сами",
  consent: "Разрешаю использовать эти видео для улучшения расчётов",
  privacy: "Видео используются только для этого расчёта и удаляются по истечении срока хранения.",
  start: "Начать",
  continueRecording: "Продолжить запись",
  inAppBrowser: "Для лучшего результата откройте ссылку в Safari или Chrome (⋯ → Открыть в браузере).",
  tips: ["Держите телефон одинаково всё время", "Идите медленно и обводите камерой комнату", "Откройте шкафы, тумбы и гараж", "Скажите вслух, что не переезжает"],
  record: "Начать запись",
  nextRoom: "Следующая комната",
  done: "Готово",
  whichRoom: "Какая комната?",
  tooDark: "Темно — включите свет",
  tooFast: "Чуть медленнее",
  paused: "Запись на паузе. Снятое сохранено.",
  cameraError: "Не удалось открыть камеру. Разрешите доступ к камере в настройках браузера или загрузите видео.",
  uploadInstead: "Загрузить видео или фото",
  uploading: (n: number) => `Загрузка… осталось частей: ${n}. Не закрывайте страницу.`,
  allUploaded: "Всё загружено.",
  doneTitle: "Спасибо!",
  doneBody: "Опись вещей готовится. Больше ничего делать не нужно.",
  expired: "Ссылка устарела или не существует. Попросите у вашей компании новую.",
  closed: "Осмотр завершён. Спасибо!",
  error: "Что-то пошло не так. Попробуйте ещё раз.",
  part: (n: number) => `Часть ${n}`,
  rooms: {
    living_room: "Гостиная", family_room: "Семейная комната", dining_room: "Столовая", kitchen: "Кухня",
    bedroom: "Спальня", kids_room: "Детская", nursery: "Комната малыша", office: "Кабинет", bathroom: "Ванная",
    laundry: "Прачечная", hallway: "Коридор и кладовки", garage: "Гараж", basement: "Подвал", attic: "Чердак",
    patio: "Двор / патио", storage: "Склад (storage)", other: "Другое",
  },
};

export const DICTIONARIES: Record<Language, Dict> = { en, ru };
export type { Dict };
