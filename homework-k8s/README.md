
```bash
minikube start
kubectl create namespace yahu --dry-run=client -o yaml | kubectl apply -f -
```

## 1. Установка PostgreSQL


```bash
kubectl apply -f homework-k8s/k8s/secret.yaml

helm upgrade --install users-db \
  oci://registry-1.docker.io/bitnamicharts/postgresql \
  --version 18.8.0 \
  --namespace yahu \
  --values homework-k8s/helm/postgresql/values.yaml \
  --wait
```

## 2. Применение первоначальной миграции

Сначала применяется ConfigMap, потому что Job миграции использует настройки
подключения к PostgreSQL из него.

```bash
kubectl apply -f homework-k8s/k8s/configmap.yaml

kubectl delete job health-service-migration \
  --namespace yahu \
  --ignore-not-found

kubectl apply -f homework-k8s/k8s/migration-job.yaml

kubectl wait \
  --for=condition=complete \
  job/health-service-migration \
  --namespace yahu \
  --timeout=120s
```

## 3. Запуск приложения


```bash
kubectl apply \
  -f homework-k8s/k8s/deployment.yaml \
  -f homework-k8s/k8s/service.yaml \
  -f homework-k8s/k8s/ingress.yaml
```

Дождаться запуска приложения:

```bash
kubectl rollout status \
  deployment/health-service \
  --namespace yahu \
  --timeout=120s
```

