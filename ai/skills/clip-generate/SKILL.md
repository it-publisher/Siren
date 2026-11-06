---
name: clip-generate
description: Сделать клипы из утверждённых кадров, поющие планы с вокалом и планы без пения
disable-model-invocation: true
---

# clip-generate

> **Статус:** работает, требуется `FAL_KEY`. Команды проверены на ручных запусках, скиллом целиком платный прогон ещё не проходил. Автозапуск выключен: шаг платный. Губы на слух подтверждены только на H3 Max в 1080P, клип 7 с. В 768P на слух не проверено.

## Назначение

Оживить кадры: планы с пением и планы без него.

## Вход

`shot-plan.md`, `scenes.json`, утверждённые кадры из `frames/`, `audio/fragment.wav`, `characters/<имя>/references/`.

## Модели

| План | По умолчанию | Цена |
|---|---|---|
| Вокал | Demucs, `fal-ai/demucs` | $0,0007/с |
| С пением | MiniMax H3 Max Lip Sync, 768P, `minimax/h3-max/lip-sync/image-to-video` | $0,08/с, клип длиннее 15 с $0,096/с |
| Без пения | Kling 4.0, 720p, `kling/v4/reference-to-video` | $0,157/с |

Пользователь может назвать любую модель fal: сверь схему на `fal.ai/models/<адрес>/api` и цену на странице модели. Остальные варианты: [гайд по моделям](../../../docs/guides/models.md).

## Шаги

Команды запускаются из `engine/`.

1. Посчитать стоимость по планам и всего, показать таблицу, дождаться подтверждения. ⛔ Без него запросы не отправлять. Перед каждым дублем стоимость показывается снова.
2. Отделить вокал один раз на весь фрагмент. `input/demucs.json`: `{ "model": "htdemucs_ft", "stems": ["vocals"], "output_format": "wav" }`.

   ```bash
   npm run generate -- --endpoint fal-ai/demucs --input ../work/<run-id>/input/demucs.json --out ../work/<run-id>/audio/vocals --upload audio_url=../work/<run-id>/audio/fragment.wav
   ```

3. Поющий план. Вокал вырезается с позиции плана в ролике: сумма `seconds` предыдущих планов. H3 Max принимает аудио от 5 с: план короче генерируется на 5 с и обрезается через `seconds`, оплата идёт за весь клип. `input/<NN>-singing.json`: `{ "resolution": "768P", "enable_transcription": false }`.

   ```bash
   ffmpeg -hide_banner -v error -y -ss <позиция> -t <секунды> -i ../work/<run-id>/audio/vocals.wav ../work/<run-id>/audio/<NN>-vocal.wav
   npm run generate -- --endpoint minimax/h3-max/lip-sync/image-to-video --input ../work/<run-id>/input/<NN>-singing.json --out ../work/<run-id>/clips/<NN>-singing --upload image_url=../work/<run-id>/frames/<кадр>.jpg --upload audio_url=../work/<run-id>/audio/<NN>-vocal.wav
   ```

4. План без пения. `input/<NN>-clip.json`:

   ```json
   { "prompt": "@Element1 <действие>. Serious calm expression, her mouth stays closed, she does not speak or sing. <движение камеры>, handheld with slight natural shake. No text, no subtitles, no cuts, one continuous shot.", "duration": 7, "aspect_ratio": "9:16", "resolution": "720p" }
   ```

   ```bash
   npm run generate -- --endpoint kling/v4/reference-to-video --input ../work/<run-id>/input/<NN>-clip.json --out ../work/<run-id>/clips/<NN>-<slug> --file start_image_url=../work/<run-id>/frames/<кадр>.jpg --file elements.0.frontal_image_url=../characters/<имя>/references/front-neutral.jpg --file elements.0.reference_image_urls.0=../characters/<имя>/references/three-quarter.jpg
   ```

5. Проверить, что модель не поставила свою склейку: в выводе должно быть `"shots":1`. Kling 4.0 Flash уже делал это на 8-секундном клипе.

   ```bash
   npm run --silent analyze-video -- --video ../work/<run-id>/clips/<клип>.mp4 --out ../work/<run-id>/checks/clips/<клип>
   ```

6. Для проверки на слух наложить на поющий план полный микс с той же позиции:

   ```bash
   ffmpeg -hide_banner -v error -y -i ../work/<run-id>/clips/<NN>-singing.mp4 -ss <позиция> -t <секунды> -i ../work/<run-id>/audio/fragment.wav -map 0:v -map 1:a -c:v copy -c:a aac -shortest ../work/<run-id>/clips/<NN>-singing-mix.mp4
   npm run review -- --run ../work/<run-id>
   ```

7. Описать только то, что видно на кадрах клипа: лицо, руки, надписи, артефакты. Агент не слышит звук, поэтому не оценивает губы. ⛔ Пользователь смотрит клипы и на слух решает, какие переделать. Дубль сохраняй с суффиксом `-2`, старый не удаляй, а в `scenes.json` укажи выбранный: скрипт не даст затереть готовый результат.
8. Записать расход по каждому клипу в `card.md`: модель, секунды, сумма.
9. Проверить `scenes.json` на готовых клипах одним кадром: `/scene-plan`, шаг проверки.

## Выход

`audio/vocals.wav`, `clips/`, запись расходов в `card.md`.

## Проверки

- Каждый клип привязан к плану из `shot-plan.md`, его длина не меньше `seconds`.
- В плане без пения одна сцена: `"shots":1`.
- Пользователь подтвердил лицо и губы.

## Если запрос оборвался

Оплаченный результат забирается без новой оплаты: `npm run generate -- --resume --out <тот же путь>`. Новый запрос с тем же `--out` скрипт не отправит, пока рядом лежит `<путь>.request.json`.

## Открытые вопросы

- Держится ли синхрон на длинном клипе и в 768P: на слух не оценивали.
- Сколько персонажей держит одна сцена.
