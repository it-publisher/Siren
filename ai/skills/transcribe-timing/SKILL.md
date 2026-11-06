---
name: transcribe-timing
description: Снять тайминги слов из вокала через Whisper и перенести их на текст песни
---

# transcribe-timing

> **Статус:** работает. Английский вокал проверен на одном фрагменте 10 с: тайминги годные, слова искажаются, метки `♪` и таймкоды за концом аудио `align` отбрасывает.

## Назначение

Получить тайминги, к которым привязываются сцены и подписи.

## Вход

`audio/fragment.wav` и слова фрагмента в `script.md`, только текст без разметки.

## Шаги

1. Запустить Whisper и перенести его тайминги на текст сценария. Первый запуск собирает whisper.cpp и качает модель, около 1,5 GB. По умолчанию язык английский, для другого добавь к `transcribe` флаг `--language <код>`.

   ```bash
   cd engine
   npm run transcribe -- --audio ../work/<run-id>/audio/fragment.wav --out ../work/<run-id>/timing/whisper.json
   npm run align -- --text ../work/<run-id>/script.md --timing ../work/<run-id>/timing/whisper.json --audio ../work/<run-id>/audio/fragment.wav --out ../work/<run-id>/timing/words.json
   ```

   Если совпало меньше 60% слов, `align` останавливается с ошибкой. Обычно это значит, что текст не от этого фрагмента.

2. Проверить порядок и границы таймингов. В `bad` должен быть пустой список.

   ```bash
   node -e "const {durationMs,words}=JSON.parse(require('fs').readFileSync(process.argv[1]));const bad=words.filter((w,i)=>w.endMs<=w.startMs||w.endMs>durationMs||(i>0&&w.startMs<words[i-1].startMs));console.log({words:words.length,durationMs,bad})" ../work/<run-id>/timing/words.json
   ```

3. Показать пользователю список `mismatches` из вывода `align`. Для этих слов текст взят из сценария, а время посчитано из нераспознанного участка. Сами расхождения не ошибка: на вокале Whisper часто слышит слова неверно.
4. Отрендерить проверку подписей и дать её посмотреть. ⛔ Синхрон подтверждает пользователь.

   ```bash
   npx remotion render CaptionsCheck ../work/<run-id>/checks/captions.mp4 --public-dir=../work/<run-id>
   ```

## Выход

`timing/whisper.json`, `timing/words.json`, `checks/captions.mp4`.

## Проверки

- Текст в `words.json` совпадает со сценарием. Текст самого Whisper совпадать не обязан.
- Тайминги идут по возрастанию и не выходят за длину аудио.
- На начала слов можно опираться при монтаже. Конец последнего слова в предложении уходит в паузу примерно на 0,3 с, опираться на него нельзя.

## Открытые вопросы

- Какая модель Whisper лучше для английского вокала.
- Точность на вокале с музыкой.
