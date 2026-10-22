# ДЗ №10. Идемпотентность API

Используется сервис «Заказ» из [ДЗ №9](../homework-9/README.md).
Идемпотентное создание заказа уже реализовано; здесь отдельно описаны
паттерн, установка и существующие проверки для этого задания.

## Паттерн

**Дедупликация по клиентскому ключу `Idempotency-Key` с хранением в PostgreSQL.**
Клиент передаёт ключ в `POST /orders`, BFF передаёт его в Order Service.
В БД действует уникальное ограничение `(user_id, idempotency_key)`.
Транзакционная блокировка по пользователю и ключу защищает от одновременных
повторов; заказ и шаги Saga сохраняются в одной транзакции.

- Новый ключ создаёт заказ и возвращает `202 Accepted`.
- Тот же пользователь, ключ и параметры возвращают тот же `orderId`.
- Изменение `productId`, `quantity` или `deliverySlotId` с тем же ключом
  возвращает `409 IDEMPOTENCY_CONFLICT`.
- Отсутствующий или некорректный ключ возвращает `400`.

Повтор возвращает текущее состояние заказа: `202` во время обработки,
`200` после завершения. Операции участников Saga привязаны к `orderId`,
чтобы повтор не приводил к повторному списанию, резерву или брони.
Ключ хранится вместе с заказом и сохраняется при перезапуске приложения.

## Установка

Команды выполняются из корня репозитория `health-service`. Нужны Minikube, kubectl и Helm 3. Все ресурсы устанавливаются в namespace **`yahu`**. Если ДЗ №9 уже развёрнуто, дополнительная установка не требуется — переходите к Postman. Команды ниже предназначены для чистого Minikube без ранее установленных компонентов.

```bash
minikube start
kubectl config use-context minikube
kubectl create namespace yahu --dry-run=client -o yaml | kubectl apply -f -
kubectl -n yahu apply -f homework-k8s/k8s/secret.yaml

helm upgrade --install users-db \
  oci://registry-1.docker.io/bitnamicharts/postgresql \
  --version 18.8.0 --namespace yahu \
  --values homework-k8s/helm/postgresql/values.yaml --wait

helm upgrade --install nginx-ingress ingress-nginx \
  --repo https://kubernetes.github.io/ingress-nginx \
  --namespace yahu \
  --values homework-k8s/nginx-ingress.yaml \
  --set controller.metrics.serviceMonitor.enabled=false --wait
```

Примените конфигурацию и выполните миграции до запуска сервисов:

```bash
kubectl -n yahu apply \
  -f homework-k8s/k8s/configmap.yaml \
  -f homework-k8s/k8s/auth-service-configmap.yaml \
  -f homework-k8s/k8s/bff-configmap.yaml \
  -f homework-8/k8s/billing-service-configmap.yaml \
  -f homework-8/k8s/order-service-configmap.yaml \
  -f homework-8/k8s/notification-service-configmap.yaml \
  -f homework-9/k8s/warehouse-service-configmap.yaml \
  -f homework-9/k8s/delivery-service-configmap.yaml

kubectl -n yahu apply \
  -f homework-k8s/k8s/migration-job.yaml \
  -f homework-k8s/k8s/auth-service-migration-job.yaml \
  -f homework-8/k8s/billing-service-migration-job.yaml \
  -f homework-8/k8s/order-service-migration-job.yaml \
  -f homework-8/k8s/notification-service-migration-job.yaml \
  -f homework-9/k8s/warehouse-service-migration-job.yaml \
  -f homework-9/k8s/delivery-service-migration-job.yaml

kubectl -n yahu wait --for=condition=complete --timeout=240s \
  job/health-service-migration job/health-auth-service-migration \
  job/health-billing-service-migration job/health-order-service-migration \
  job/health-notification-service-migration \
  job/health-warehouse-service-migration job/health-delivery-service-migration
```

После успешных миграций установите сервисы и Ingress:

```bash
kubectl -n yahu apply \
  -f homework-k8s/k8s/service.yaml \
  -f homework-k8s/k8s/auth-service-service.yaml \
  -f homework-k8s/k8s/bff-service.yaml \
  -f homework-8/k8s/billing-service-service.yaml \
  -f homework-8/k8s/order-service-service.yaml \
  -f homework-8/k8s/notification-service-service.yaml \
  -f homework-9/k8s/warehouse-service-service.yaml \
  -f homework-9/k8s/delivery-service-service.yaml \
  -f homework-k8s/k8s/deployment.yaml \
  -f homework-k8s/k8s/auth-service-deployment.yaml \
  -f homework-8/k8s/notification-service-deployment.yaml \
  -f homework-9/k8s/warehouse-service-deployment.yaml \
  -f homework-9/k8s/delivery-service-deployment.yaml \
  -f homework-8/k8s/billing-service-deployment.yaml \
  -f homework-8/k8s/order-service-deployment.yaml \
  -f homework-k8s/k8s/bff-deployment.yaml \
  -f homework-k8s/k8s/ingress.yaml

kubectl -n yahu rollout status deployment/health-service --timeout=180s
kubectl -n yahu rollout status deployment/health-auth-service --timeout=180s
kubectl -n yahu rollout status deployment/health-notification-service --timeout=180s
kubectl -n yahu rollout status deployment/health-warehouse-service --timeout=180s
kubectl -n yahu rollout status deployment/health-delivery-service --timeout=180s
kubectl -n yahu rollout status deployment/health-billing-service --timeout=180s
kubectl -n yahu rollout status deployment/health-order-service --timeout=180s
kubectl -n yahu rollout status deployment/health-bff --timeout=180s
```

## Postman

Используется готовая [коллекция ДЗ №9](../homework-9/postman/distributed-transactions.postman_collection.json).
Начальное значение `{{baseUrl}}` — **`http://arch.homework`**.
Запускайте коллекцию целиком: она создаёт пользователя и подготавливает заказы.
Проверки для этого задания:

- `25 Replay successful order` — повтор возвращает тот же подтверждённый заказ;
- `26 Changed replay rejected` — изменение параметров с тем же ключом даёт `409`;
- `27 Final balance` — повторы не приводят к дополнительному списанию.

Для локального запуска добавьте `127.0.0.1 arch.homework` в `/etc/hosts`
и запустите в отдельном терминале:

```bash
kubectl -n yahu port-forward service/nginx-ingress-nginx-controller 8081:80
```

Затем из корня репозитория:

```bash
npx --yes newman@6.2.2 run homework-9/postman/distributed-transactions.postman_collection.json \
  --env-var baseUrl=http://arch.homework:8081 --reporters cli
```

Порт переопределяется только для локального запуска. Для полного прогона
коллекции нужны доступные товары и слоты доставки; тестовый склад конечен.
