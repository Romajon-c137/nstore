from rest_framework.pagination import PageNumberPagination


class StandardPagination(PageNumberPagination):
    page_size = 24
    page_size_query_param = "page_size"
    # The storefront loads the full local catalog for client-side search and
    # filtering. Larger pages avoid dozens of sequential browser requests.
    max_page_size = 1000
