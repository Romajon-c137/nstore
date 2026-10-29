from django.urls import path

from .views import CategoryListView, ProductDetailView, ProductListView, ProductLookupView

urlpatterns = [
    path("categories/", CategoryListView.as_view(), name="categories"),
    path("products/", ProductListView.as_view(), name="products"),
    path("products/lookup/", ProductLookupView.as_view(), name="product-lookup"),
    path("products/<slug:slug>/", ProductDetailView.as_view(), name="product-detail"),
]
