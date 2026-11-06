---
name: render-check
description: Отрендерить финальный ролик 1080x1920, проверить параметры, громкость и контрольные кадры
---

# render-check

> **Статус:** работает для всех форматов с шаблоном. На `talking-closeup` и `story-clip` команды проверены на черновиках. Дефекты на кадрах ищет агент глазами, автоматического детектора нет.

## Назначение

Получить финальный MP4 и найти дефекты до публикации.

## Вход

Утверждённый `scenes.json` и данные запуска.

## Шаги

1. Отрендерить MP4 из `engine/` композицией формата: `talking-closeup` → `TalkingCloseup`, `story-clip` → `StoryClip`. Нужна сеть для шрифтов. Рендер долгий, запускай в фоне.

   ```bash
   cd engine
   npx remotion render StoryClip ../work/<run-id>/render/final.mp4 --public-dir=../work/<run-id>
   ```

2. Проверить параметры файла.

   ```bash
   ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,r_frame_rate:format=duration -of compact ../work/<run-id>/render/final.mp4
   ```

3. Измерить громкость.

   ```bash
   ffmpeg -hide_banner -nostats -i ../work/<run-id>/render/final.mp4 -af ebur128=peak=true -f null - 2>&1 | grep -A13 Summary | grep -E " I:|Peak:"
   ```

4. Извлечь контрольные кадры: первый, каждые 5 секунд и последний.

   ```bash
   F=../work/<run-id>/render/final.mp4; D=../work/<run-id>/checks/frames; mkdir -p "$D"
   ffmpeg -hide_banner -v error -y -i "$F" -frames:v 1 -vf scale=540:-2 "$D/first.jpg"
   ffmpeg -hide_banner -v error -y -i "$F" -vf "fps=1/5,scale=540:-2" "$D/f%03d.jpg"
   ffmpeg -hide_banner -v error -y -sseof -0.1 -i "$F" -frames:v 1 -update 1 -vf scale=540:-2 "$D/last.jpg"
   ```

5. Открыть каждый кадр и найти обрезанный текст, наложения и пустые экраны. Ещё лицо, руки, надписи и артефакты. Называй только то, что видно: реализм и губы оценивает пользователь.
6. Записать отчёт в `checks/report.md`: таблица «Проверка, значение, результат» и список дефектов с временем в ролике.
7. Дать ролик пользователю. ⛔ Ритм и рассинхрон по редким кадрам не видны, их оценивает человек.

## Выход

`render/final.mp4`, `checks/frames/`, `checks/report.md`.

## Проверки

| Проверка | Норма |
|---|---|
| Видео | H.264, 1080×1920, `30/1` |
| Звук | Дорожка AAC есть, если в `scenes.json` задан хоть один звук. У ролика без звука её нет, это отмечается в отчёте |
| Длительность | `durationMs` из `words.json` или сумма `seconds` планов из `scenes.json`, отклонение до 0,1 с |
| Первый кадр | Не пустой, иначе предупреждение: он может стать превью |
| Пик | Не выше −1 dBFS, иначе дефект |
| Громкость | От −16 до −12 LUFS, иначе предупреждение в отчёте |
| Кадры | Нет обрезанного текста, наложений и пустых экранов |

## Открытые вопросы

- Официальные требования Instagram: справка не открылась, числа взяты из сторонних гайдов.
- Норматив громкости Reels: −14 LUFS — рабочее значение проекта.
