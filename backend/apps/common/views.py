from django.db import connection
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView


class StatusSerializer(serializers.Serializer):
    status = serializers.CharField()


class HealthView(APIView):
    authentication_classes = []
    serializer_class = StatusSerializer

    def get(self, request):
        return Response({"status": "ok"})


class ReadinessView(APIView):
    authentication_classes = []
    serializer_class = StatusSerializer

    def get(self, request):
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        return Response({"status": "ready"})
