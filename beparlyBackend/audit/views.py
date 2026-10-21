import uuid

from django.http import JsonResponse
from rest_framework.views import APIView

from accounts.views import current_member, current_session, error

from .models import AuditEvent


class AuditListView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request, business_id):
        session = current_session(request)
        if not session:
            return error('unauthorized', 'Please sign in.', 401)
        if not current_member(session, business_id):
            return error('not_found', 'Business profile not found.', 404)

        events = AuditEvent.objects.filter(business_id=business_id)
        product_id = request.query_params.get('product_id')
        location_id = request.query_params.get('location_id')
        entity_type = request.query_params.get('entity_type')
        if product_id:
            try:
                events = events.filter(product_id=uuid.UUID(product_id))
            except ValueError:
                return error('invalid_input', 'Choose a valid product.')
        if location_id:
            try:
                events = events.filter(location_id=int(location_id))
            except ValueError:
                return error('invalid_input', 'Choose a valid location.')
        if entity_type:
            if entity_type not in {'product', 'category', 'package', 'batch', 'location', 'stock'}:
                return error('invalid_input', 'Choose a valid audit type.')
            events = events.filter(entity_type=entity_type)
        try:
            page = int(request.query_params.get('page', '1'))
        except ValueError:
            return error('invalid_input', 'Choose a valid page.')
        if page < 1 or page > 100000:
            return error('invalid_input', 'Choose a valid page.')
        rows = list(events.select_related('actor').order_by('-created_at', '-id')[(page - 1) * 30:page * 30 + 1])
        return JsonResponse({'events': [{
            'id': str(row.id), 'entity_type': row.entity_type, 'entity_id': row.entity_id,
            'subject': row.subject, 'location_id': row.location_id,
            'action': row.action, 'changes': row.changes,
            'actor': row.actor.first_name or row.actor.phone if row.actor else 'System',
            'created_at': row.created_at.isoformat(),
        } for row in rows[:30]], 'next_page': page + 1 if len(rows) > 30 else None})
