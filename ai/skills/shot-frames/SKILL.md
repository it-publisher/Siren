---
name: shot-frames
description: Сгенерировать стартовые кадры планов по референсам персонажа и утвердить их до генерации видео
disable-model-invocation: true
---

# shot-frames

> **Статус:** работает, требуется `FAL_KEY`. Команды и рецепт взяты из ручных запусков, скиллом целиком платный прогон ещё не проходил. Автозапуск выключен: шаг платный.

## Назначение

Утвердить картинку каждого плана до дорогой генерации видео.

## Вход

`shot-plan.md`, `characters/<имя>/bible.md`, `characters/<имя>/references/`. Для нового персонажа сначала `/character-create`.

## Модели

По умолчанию Seedream 4.5 Edit, $0,04 за кадр. Пользователь может назвать любую модель fal: сверь схему и цену на её странице. Сравнение: [гайд по моделям](../../../docs/guides/models.md).

## Шаги

Команды запускаются из `engine/`.

1. Составить промпт каждого плана в `input/<NN-slug>.json` по рецепту реализма из гайда по моделям:

   ```json
   { "prompt": "The same woman as in the reference images: fictional adult woman, <возраст>, keep her face, age and hair exactly the same, with <цвет глаз> eyes. <сцена и действие>. Candid documentary photo with human imperfections: slightly off-centre framing, focus slightly missed, visible noise in the shadows, muted colors. Real imperfect skin, no retouching. Not a posed portrait. No text.", "image_size": "portrait_16_9", "num_images": 1, "max_images": 1 }
   ```

   - Средние и крупные планы. Широкий план предлагай только с оговоркой, что пока он выглядит как ИИ.
   - Сумерки или полумрак, лицо частично в тени, фон сильно размыт.
   - Цвет глаз в каждом промпте. Съёмка со стороны, без слов про телефон.
   - Микрофон и другие сложные предметы только размытым краем на переднем плане.

2. Показать число кадров и цену, дождаться подтверждения. ⛔ Без него запросы не отправлять.
3. Сгенерировать кадры. Референс выбирай по ракурсу плана, передавать можно несколько.

   ```bash
   npm run generate -- --endpoint fal-ai/bytedance/seedream/v4.5/edit --input ../work/<run-id>/input/02-studio.json --out ../work/<run-id>/frames/02-studio --reference ../characters/<имя>/references/front-neutral.jpg --reference ../characters/<имя>/references/three-quarter.jpg
   npm run review -- --run ../work/<run-id>
   ```

4. Описать, что видно на кадрах: лицо, глаза, руки, надписи, поза. Не называть кадр реалистичным только потому, что он красивый: закат, идеальная композиция и ровные веснушки работают против реализма.
5. ⛔ Пользователь смотрит галерею `review.html` и утверждает кадры. Новый вариант сохраняй с суффиксом `-2`, старый не удаляй: скрипт не даст затереть готовый результат.
6. Записать утверждённые файлы в `shot-plan.md`, расход в `card.md`.
7. Показать оценку следующего шага: `/clip-generate`.

## Выход

`input/`, `frames/`, записи в `shot-plan.md` и `card.md`.

## Проверки

- Персонаж узнаётся, цвет глаз верный, нет дефектов лица и рук, нет надписей.
- Кадр 9:16. Seedream 4.5 с `portrait_16_9` даёт 2304×4096, шаблон подгоняет кадр сам.
- Пользователь утвердил все кадры.

## Если запрос оборвался

Оплаченный результат забирается без новой оплаты: `npm run generate -- --resume --out <тот же путь>`. Новый запрос с тем же `--out` скрипт не отправит, пока рядом лежит `<путь>.request.json`.
