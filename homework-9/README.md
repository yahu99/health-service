# Распределённая транзакция: оформление заказа

## Паттерн

Используется **Saga с оркестрацией по HTTP**. Оркестратор — Order Service. После `POST /orders` он сохраняет заказ и состояния шагов в PostgreSQL, возвращает `202 Accepted` и сразу запускает обработку. Фоновый обработчик продолжает незавершённые саги после сбоев. Последовательность: Billing списывает оплату → Warehouse резервирует товар → Delivery бронирует курьера на выбранный временной слот. После трёх подтверждений заказ становится `CONFIRMED`.

При отказе участника выполненные действия компенсируются в обратном порядке: отмена брони курьера, освобождение товара, возврат оплаты. После подтверждения компенсаций заказ становится `CANCELLED`. Таймаут не считается отказом: результат выясняется повтором идемпотентной команды. Операции участников привязаны к `orderId`, а повтор `POST /orders` защищён заголовком `Idempotency-Key`. Состояния шагов хранятся в `order_saga_steps`; HTTP-запросы не выполняются внутри открытой SQL-транзакции.

Клиент выбирает `productId` и `deliverySlotId`. Цену Order Service берёт из своего каталога и сохраняет в заказе. Каталог доступен через `GET /products`, свободные слоты — через `GET /delivery/slots`.

## Установка

Команды выполняются из корня репозитория `health-service`. Нужны Minikube, kubectl и Helm 3. Все ресурсы устанавливаются в namespace **`yahu`**. Инструкция рассчитана на чистый Minikube без ранее установленных компонентов.

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

Все Deployment и миграционные Job используют образы из Docker Hub, указанные в манифестах. Для версии Homework 9 это `yahurt/health-bff:3.0.0`, `yahurt/health-billing-service:2.0.0`, `yahurt/health-order-service:2.0.0`, `yahurt/health-warehouse-service:1.0.0` и `yahurt/health-delivery-service:1.0.0`. Кластер загрузит их при запуске Pod.

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

Коллекция: [distributed-transactions.postman_collection.json](postman/distributed-transactions.postman_collection.json). Начальное значение `{{baseUrl}}` — **`http://arch.homework`**. Каждый запуск регистрирует нового пользователя и проверяет успешный заказ, отказ оплаты, отсутствие товара, занятый слот курьера, компенсации и идемпотентность.

Для локального доступа добавьте `127.0.0.1 arch.homework` в `/etc/hosts`. В отдельном терминале оставьте работающим:

```bash
kubectl -n yahu port-forward service/nginx-ingress-nginx-controller 8081:80
```

Проверка и запуск через Newman (порт переопределяется только для локального port-forward):

```bash
curl http://arch.homework:8081/health/ready
npm install -g newman@6.2.2
newman run homework-9/postman/distributed-transactions.postman_collection.json \
  --env-var baseUrl=http://arch.homework:8081 --reporters cli
```
