from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from django.contrib.auth.password_validation import validate_password
from django import forms
from django.core.exceptions import ValidationError

from .models import AuthSession, Business, BusinessMember, User, normalize_phone


class AdminUserAddForm(forms.ModelForm):
    phone = forms.CharField(max_length=24, help_text='Bangladeshi mobile number, for example 01812345678 or +8801812345678.')
    business = forms.ModelChoiceField(queryset=Business.objects.all(), help_text='Business this person can sign in to.')
    role = forms.ChoiceField(choices=BusinessMember.ROLE_CHOICES, initial=BusinessMember.OWNER)
    password1 = forms.CharField(label='Password', widget=forms.PasswordInput)
    password2 = forms.CharField(label='Confirm password', widget=forms.PasswordInput)

    class Meta:
        model = User
        fields = ('phone', 'first_name', 'last_name')

    def clean_phone(self):
        phone = normalize_phone(self.cleaned_data['phone'])
        if User.objects.filter(phone=phone).exists():
            raise forms.ValidationError('A user with this phone number already exists.')
        return phone

    def clean(self):
        data = super().clean()
        if data.get('password1') and data.get('password2') and data['password1'] != data['password2']:
            self.add_error('password2', 'Passwords do not match.')
        if data.get('password1'):
            try:
                validate_password(data['password1'], User(phone=data.get('phone', ''), first_name=data.get('first_name', '')))
            except ValidationError as exc:
                self.add_error('password1', exc)
        return data

    def save(self, commit=True):
        user = super().save(commit=False)
        user.set_password(self.cleaned_data['password1'])
        if commit:
            user.save()
        return user


class BusinessMemberInline(admin.TabularInline):
    model = BusinessMember
    extra = 0
    autocomplete_fields = ('business',)


class BusinessOwnerForm(forms.ModelForm):
    owner = forms.ModelChoiceField(queryset=User.objects.filter(is_active=True), required=False,
                                   help_text='Select an existing user, enter a new owner below, or assign one later.')
    new_owner_phone = forms.CharField(required=False, max_length=24,
                                      help_text='Bangladeshi mobile number for a new owner.')
    new_owner_first_name = forms.CharField(required=False, max_length=150)
    new_owner_last_name = forms.CharField(required=False, max_length=150)
    new_owner_password1 = forms.CharField(required=False, label='New owner password', widget=forms.PasswordInput)
    new_owner_password2 = forms.CharField(required=False, label='Confirm new owner password', widget=forms.PasswordInput)

    class Meta:
        model = Business
        fields = '__all__'

    def clean(self):
        data = super().clean()
        if self.instance.pk:
            return data
        owner = data.get('owner')
        new_fields = ('new_owner_phone', 'new_owner_first_name', 'new_owner_last_name',
                      'new_owner_password1', 'new_owner_password2')
        if owner:
            if any(data.get(field) for field in new_fields):
                self.add_error('owner', 'Choose an existing owner or enter a new owner, not both.')
            return data
        if not any(data.get(field) for field in new_fields):
            return data
        if not data.get('new_owner_phone'):
            self.add_error('new_owner_phone', 'Enter a new owner phone number or select an existing owner.')
        else:
            try:
                phone = normalize_phone(data['new_owner_phone'])
            except ValidationError as exc:
                self.add_error('new_owner_phone', exc)
            else:
                if User.objects.filter(phone=phone).exists():
                    self.add_error('new_owner_phone', 'This user already exists. Select them as the existing owner.')
                data['new_owner_phone'] = phone
        password1 = data.get('new_owner_password1')
        password2 = data.get('new_owner_password2')
        if not password1:
            self.add_error('new_owner_password1', 'Enter a password for the new owner.')
        elif password1 != password2:
            self.add_error('new_owner_password2', 'Passwords do not match.')
        else:
            try:
                validate_password(password1, User(phone=data.get('new_owner_phone', ''),
                                                  first_name=data.get('new_owner_first_name', '')))
            except ValidationError as exc:
                self.add_error('new_owner_password1', exc)
        return data


@admin.register(User)
class AccountAdmin(UserAdmin):
    add_form = AdminUserAddForm
    inlines = (BusinessMemberInline,)
    list_display = ('phone', 'first_name', 'businesses', 'is_active', 'is_staff')
    search_fields = ('phone', 'first_name', 'memberships__business__name')
    ordering = ('phone',)
    fieldsets = (
        (None, {'fields': ('phone', 'password')}),
        ('Personal information', {'fields': ('first_name', 'last_name', 'email')}),
        ('Permissions', {'fields': ('is_active', 'is_staff', 'is_superuser', 'groups', 'user_permissions')}),
        ('Important dates', {'fields': ('last_login', 'date_joined')}),
    )
    add_fieldsets = (
        (None, {'fields': ('phone', 'first_name', 'last_name', 'business', 'role', 'password1', 'password2')}),
    )

    @admin.display(description='Businesses')
    def businesses(self, obj):
        return ', '.join(member.business.name for member in obj.memberships.select_related('business').all())

    def get_inline_instances(self, request, obj=None):
        return [] if obj is None else super().get_inline_instances(request, obj)

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        if not change:
            BusinessMember.objects.create(user=form.instance, business=form.cleaned_data['business'],
                                          role=form.cleaned_data['role'])


@admin.register(Business)
class BusinessAdmin(admin.ModelAdmin):
    form = BusinessOwnerForm
    list_display = ('name', 'owner_names', 'created_at')
    search_fields = ('name', 'members__user__phone')
    inlines = (BusinessMemberInline,)

    def get_fieldsets(self, request, obj=None):
        if obj is None:
            return (
                (None, {'fields': ('name', 'phone', 'address')}),
                ('Owner', {'fields': ('owner', 'new_owner_phone', 'new_owner_first_name',
                                      'new_owner_last_name', 'new_owner_password1', 'new_owner_password2')}),
            )
        return (
            (None, {'fields': ('name', 'phone', 'address', 'timezone')}),
            ('Documents', {'fields': ('invoice_paper', 'receipt_paper', 'logo', 'invoice_footer_text', 'label_print_settings', 'show_currency_symbol')}),
            ('Inventory', {'fields': ('expiry_warning_days',)}),
        )

    @admin.display(description='Owners')
    def owner_names(self, obj):
        return ', '.join(member.user.phone for member in obj.members.select_related('user').filter(role=BusinessMember.OWNER))

    def get_inline_instances(self, request, obj=None):
        return [] if obj is None else super().get_inline_instances(request, obj)

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        if not change:
            from accounting.services import setup_business
            setup_business(obj)

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        if not change:
            owner = form.cleaned_data.get('owner')
            if owner is None and form.cleaned_data.get('new_owner_phone'):
                owner = User.objects.create_user(
                    phone=form.cleaned_data['new_owner_phone'],
                    password=form.cleaned_data['new_owner_password1'],
                    first_name=form.cleaned_data.get('new_owner_first_name', ''),
                    last_name=form.cleaned_data.get('new_owner_last_name', ''),
                )
            if owner is not None:
                BusinessMember.objects.create(business=form.instance, user=owner, role=BusinessMember.OWNER)


@admin.register(BusinessMember)
class BusinessMemberAdmin(admin.ModelAdmin):
    list_display = ('business', 'user', 'role', 'can_manage_locations', 'created_at')
    list_filter = ('role',)
    search_fields = ('business__name', 'user__phone')


@admin.register(AuthSession)
class AuthSessionAdmin(admin.ModelAdmin):
    list_display = ('user', 'created_at', 'expires_at', 'revoked_at')
    readonly_fields = ('user', 'token_hash', 'created_at', 'expires_at', 'revoked_at')
    search_fields = ('user__phone',)

    def has_add_permission(self, request):
        return False
