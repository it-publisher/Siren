---
name: format-add
description: Добавить новый формат рилса по видео-референсу из папки ref или описанию пользователя
---

# format-add

> **Статус:** работает как инструкция. Разбор проверен на роликах из `ref/`, порядок сборки повторяет `talking-closeup` и `story-clip`. Новый формат этим скиллом целиком ещё не добавляли.

## Назначение

Подключить новый формат без переделки ядра движка.

## Вход

Новый файл в `ref/`, названный по формату, и описание от пользователя. Формат может быть и без рефа. Файлы в `ref/` не менять.

## Шаги

1. Снять замеры в рабочую папку: `ref/` только для чтения.

   ```bash
   cd engine
   npm run --silent analyze-video -- --video ../ref/<slug>.mp4 --out ../work/format-<slug>/analysis --frame-every 1
   ```

2. Посмотреть кадры, движение и подписи. Спектрограмма: `ffmpeg -hide_banner -v error -y -i ../ref/<slug>.mp4 -lavfi showspectrumpic=s=1200x600 ../work/format-<slug>/analysis/spectrum.png`.
3. Заполнить `formats/<slug>/format.md` по `templates/format.md`. Измерения отделять от предположений.
4. Определить линию (`motion`, `footage`, `generative`). Назвать нужные инструменты и цену прохода. Новые инструменты проверить по первоисточнику и добавить в `ai/context/stack.md`.
5. Обновить `formats/README.md` и `ref/README.md`. ⛔ Показать разбор пользователю: стоит ли делать шаблон, решает он. Если нет, формат остаётся в статусе «Разбор».
6. Собрать шаблон по образцу ближайшего формата. Образцы: `story-clip` для нескольких клипов под одну дорожку, `talking-closeup` для подписей.
   - `engine/src/formats/<slug>/model.ts`: тип файла, чистые функции, `validateRun` с понятными ошибками.
   - `engine/src/formats/<slug>/<Имя>.tsx`: `calculateMetadata` читает `scenes.json` и вызывает `validateRun`.
   - `engine/src/Root.tsx`: новая `Composition`, длина и размер из `reel.ts`.
   - `engine/test/<slug>-model.test.mjs`: схема и расчёты времени.
7. Описать схему `scenes.json` и команду запуска в `format.md`, положить эталон в `formats/<slug>/example/`, если он не платный.
8. Прогнать проверки и рендер на эталоне:

   ```bash
   npm run lint
   npm test
   npx remotion render <Имя> ../work/<run-id>/render/final.mp4 --public-dir=../work/<run-id>
   ```

9. Прописать формат там, где перечислены композиции: `reel-new`, `scene-plan`, `remotion-compose`, `render-check`, `engine/README.md`, `README.md`, строка статуса в `AGENTS.md`, гайд аккаунта.
10. ⛔ Пользователь смотрит эталонный ролик. Значимые решения записать в `ai/context/decisions.md`.

## Выход

`formats/<slug>/`, шаблон и тесты в `engine/`, обновлённые индексы и скиллы.

## Проверки

- Измерения отделены от предположений.
- Схема ловит битый `scenes.json` понятной ошибкой.
- `npm run lint` и `npm test` проходят, эталон рендерится в H.264, 1080×1920, 30 fps.
- Платная генерация для эталона прошла только после подтверждения стоимости.
