from django.conf import settings
from django.http import HttpResponse
from urllib.parse import urlsplit


def allowed_origin(origin):
    if origin in settings.API_ALLOWED_ORIGINS:
        return True
    if not settings.DEBUG or not origin:
        return False
    parsed = urlsplit(origin)
    return (
        parsed.scheme == 'http'
        and parsed.hostname in {'localhost', '127.0.0.1'}
        and not parsed.path
        and not parsed.query
        and not parsed.fragment
    )


class ApiCorsMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        origin = request.headers.get('Origin')
        allowed = request.path.startswith('/api/v1/') and allowed_origin(origin)
        if allowed and request.method == 'OPTIONS':
            response = HttpResponse(status=204)
        else:
            response = self.get_response(request)
        if allowed:
            response['Access-Control-Allow-Origin'] = origin
            response['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, OPTIONS'
            response['Access-Control-Allow-Headers'] = 'Authorization, Content-Type'
            response['Vary'] = 'Origin'
        return response
