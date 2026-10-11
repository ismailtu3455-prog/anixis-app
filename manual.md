# Cloudflare Worker

Альтернативный (полностью бесплатный, не нужно покупать домен в отличии от [CfProxy](./CfProxy.md)) способ проксирования.

Прокси возвращает доступ к тому, что раньше не загружалось (реакции, некоторые стикеры). Если на аккаунте без Premium с данным способом все еще не загружаются фото/видео, оставьте в блоке `DC → IP` только `4:149.154.167.220`

##

1. включите впн или же используйте свой домен 
2. Создайте аккаунт в [Cloudflare](https://dash.cloudflare.com/) (или войдите в существующий)
	* **После создания аккаунта подтвердите почту с помощью письма, который вам пришел на email**
3. Слева в панели выберите `Compute` → `Workers & Pages`  
   <img width="250" height="768" alt="image" src="https://github.com/user-attachments/assets/d81e3522-045a-4e65-9c2e-5545b7ad409a" />

4. Нажмите сверху справа кнопку **`Create application`** → `Start with Hello World!` → `Deploy`  
   <img width="1406" height="193" alt="image" src="https://github.com/user-attachments/assets/7ac65944-8761-42a6-ab6d-ba5f9080c883" />  
   <img width="586" height="379" alt="image" src="https://github.com/user-attachments/assets/ff901439-c2a1-4867-95de-e11b82a37044" />  
   <img width="624" height="694" alt="image" src="https://github.com/user-attachments/assets/bb68d49a-166d-42a0-8fe2-bd2b16c0d066" />

5. Сверху справа нажмите кнопку **`Edit code`**, замените код слева на тот, [что находится внизу этой страницы](./CfWorker.md#код-workerа)
    * Если у вас не загружается код, то вы не выполнили первый пункт  
    <img width="911" height="117" alt="image" src="https://github.com/user-attachments/assets/6bcdf839-d776-47e9-9d18-ba0efdf53244" />  
	<img width="1027" height="512" alt="image" src="https://github.com/user-attachments/assets/daf131ed-82d5-40f0-a7eb-daeb598bea40" />


6. Нажмите сверху справа кнопку **`Deploy`**  
   <img width="415" height="138" alt="image" src="https://github.com/user-attachments/assets/58d8f83e-d8b5-40cf-a30f-741d7311047b" />

7. Скопируйте домен из поля справа и укажите его в настройках **Cloudflare Worker** (или через аргумент `--cfproxy-worker-domain`)
    * Пример домена: `random-symbols-1234.username.workers.dev`
	* **Можно указывать несколько доменов через запятую (или повторением аргумента `--cfproxy-worker-domain`)**
   <img width="414" height="182" alt="image" src="https://github.com/user-attachments/assets/4fb0b111-8026-4d17-b993-6c70ec37f1f5" />


### Код Worker'а
```
```
