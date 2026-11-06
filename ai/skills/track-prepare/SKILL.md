---
name: track-prepare
description: Выбрать фрагмент готового трека и разметить биты для музыкального рилса
---

# track-prepare

> **Статус:** работает. Анализ проверен на настоящем треке и фрагменте. Припев скрипт не определяет: он предлагает самые энергичные участки, выбирает человек.

## Назначение

Подготовить фрагмент, к которому привяжется весь монтаж.

## Вход

Трек и текст песни из `brief.yaml`, длина фрагмента `fragment_seconds`. Первый запуск скачивает librosa через `uv`.

## Шаги

Команды запускаются из `engine/`. Скрипт читает WAV и MP3. Звук из видео сначала извлеки: `ffmpeg -hide_banner -v error -y -i <видео> -vn -ar 44100 -ac 2 <файл>.wav`.

1. Найти биты и предложить фрагменты.

   ```bash
   npm run --silent analyze-track -- --audio <трек> --out ../work/<run-id>/timing/track-analysis.json --fragment <секунды>
   ```

2. Сопоставить `candidates` с текстом песни и показать пользователю 2–3 варианта: начало, конец, строки текста. ⛔ Фрагмент подтверждает он на слух.
3. Вырезать фрагмент и разметить биты уже в нём: время в `beats.json` считается от начала фрагмента.

   ```bash
   ffmpeg -hide_banner -v error -y -ss <начало> -t <длина> -i <трек> -ar 48000 -ac 2 ../work/<run-id>/audio/fragment.wav
   npm run --silent analyze-track -- --audio ../work/<run-id>/audio/fragment.wav --out ../work/<run-id>/timing/beats.json
   ```

4. Если в ролике есть подписи, записать слова фрагмента в `script.md` без разметки и снять тайминги скиллом `/transcribe-timing`.

## Выход

`audio/fragment.wav`, `timing/track-analysis.json`, `timing/beats.json`, для подписей `script.md`.

## Проверки

- Длина `fragment.wav` совпадает с подтверждённой, отклонение до 0,1 с: `ffprobe -v error -show_entries format=duration -of csv=p=0 <файл>`.
- Начало и конец не обрывают фразу: подтверждает пользователь на слух.

## Открытые вопросы

- Сильная доля отдельно не определяется: `beatsSeconds` содержит все биты, начало такта размечается на слух.
